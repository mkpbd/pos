<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Purchasing\Domain\PurchaseOrderStatus;
use App\Modules\Purchasing\Infrastructure\Documents\PurchaseOrderDocument;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrder;
use App\Modules\Purchasing\Infrastructure\Notifications\PurchaseOrderMail;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\DocumentLetterhead;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Infrastructure\Export\ExportValues;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Validation\ValidationException;

/**
 * E-mails an ordered (or partly received) purchase order to the supplier (ST2b), to the given
 * address or the supplier's own. As SendRfq: the PDF is rendered inside the transaction, so a
 * PDF failure (503 PDF_UNAVAILABLE) sends nothing; the e-mail is queued after the commit.
 * Records emailed_at / emailed_to and audits the address.
 */
class EmailPurchaseOrder
{
    public function __construct(
        private readonly PurchaseOrderDocument $document,
        private readonly SupplierDirectory $suppliers,
        private readonly DocumentLetterhead $letterhead,
        private readonly AuditTrail $audit,
    ) {}

    public function send(PurchaseOrder $order, ?string $to): PurchaseOrder
    {
        return DB::transaction(function () use ($order, $to) {
            $locked = PurchaseOrder::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
            if (! in_array($locked->status, [PurchaseOrderStatus::Ordered, PurchaseOrderStatus::PartiallyReceived], true)) {
                throw new BusinessRuleViolation('PURCHASE_ORDER_NOT_ORDERED', "Purchase order {$locked->number} is {$locked->status->value}; only an ordered purchase order can be e-mailed.", ['status' => $locked->status->value]);
            }
            $contact = $this->suppliers->contacts($locked->organization_id, [$locked->supplier_id])[$locked->supplier_id];
            $address = filled($to) ? (string) $to : $contact['email'];
            if ($address === null || filter_var($address, FILTER_VALIDATE_EMAIL) === false) {
                throw ValidationException::withMessages(['to' => [filled($to) ? 'Enter a valid e-mail address.' : "{$contact['name']} has no e-mail address; enter one."]]);
            }
            $letterhead = $this->letterhead->forOrganization($locked->organization_id);

            $mail = new PurchaseOrderMail(
                organizationName: $letterhead['name'],
                replyTo: filled($letterhead['email'] ?? null) ? (string) $letterhead['email'] : null,
                supplierName: $contact['contact_person'] ?: $contact['name'],
                order: [
                    'number' => $locked->number,
                    'expected_date' => $locked->expected_date?->format('d M Y'),
                    'total' => ExportValues::grouped($locked->total, 2),
                    'currency' => $locked->currency,
                ],
                filename: PurchaseOrderDocument::filename($locked, $contact),
                pdfBase64: base64_encode($this->document->render($locked)),
            );
            $previous = $locked->emailed_to;
            $locked->forceFill(['emailed_at' => now(), 'emailed_to' => $address])->save();
            $this->audit->record('purchase_order.emailed', $locked, ['emailed_to' => $previous], ['emailed_to' => $address]);

            DB::afterCommit(fn () => Notification::route('mail', $address)->notify($mail));

            return $locked;
        });
    }
}
