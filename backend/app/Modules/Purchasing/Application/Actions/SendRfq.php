<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Purchasing\Application\Services\ProcurementHistory;
use App\Modules\Purchasing\Domain\Procurement\RfqStatus;
use App\Modules\Purchasing\Infrastructure\Documents\RfqDocument;
use App\Modules\Purchasing\Infrastructure\Models\Rfq;
use App\Modules\Purchasing\Infrastructure\Models\RfqSupplier;
use App\Modules\Purchasing\Infrastructure\Notifications\RfqRequestMail;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\DocumentLetterhead;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Validation\ValidationException;

/**
 * Sends an RFQ (SC2): draft → sent, with at least two invited suppliers, one line and a
 * reply-by date. Every invited supplier is issued the request: suppliers with an e-mail
 * address get a queued e-mail with their PDF attached (emailed_at, address recorded); the
 * others are left to "send manually" (the PDF is downloadable per supplier). PDFs for
 * e-mail are rendered inside the transaction, so a PDF failure (503 PDF_UNAVAILABLE) sends
 * nothing; e-mails are queued after the commit.
 */
class SendRfq
{
    public const MIN_SUPPLIERS = 2;

    public function __construct(
        private readonly RfqDocument $document,
        private readonly SupplierDirectory $suppliers,
        private readonly DocumentLetterhead $letterhead,
        private readonly ProcurementHistory $history,
        private readonly AuditTrail $audit,
    ) {}

    public function send(Rfq $rfq): Rfq
    {
        return DB::transaction(function () use ($rfq) {
            $locked = Rfq::query()->whereKey($rfq->id)->lockForUpdate()->firstOrFail();
            if ($locked->status !== RfqStatus::Draft) {
                throw new BusinessRuleViolation('INVALID_STATUS_CHANGE', "RFQ {$locked->number} is {$locked->status->value}; it cannot be sent.", ['from' => $locked->status->value, 'to' => 'sent']);
            }
            $invited = $locked->suppliers()->get();
            if ($invited->count() < self::MIN_SUPPLIERS) {
                throw new BusinessRuleViolation('RFQ_SUPPLIERS_REQUIRED', 'Invite at least '.self::MIN_SUPPLIERS.' suppliers before sending.', ['min' => self::MIN_SUPPLIERS, 'invited' => $invited->count()]);
            }
            if (! $locked->lines()->exists()) {
                throw new BusinessRuleViolation('RFQ_EMPTY', 'Add at least one line before sending.');
            }
            if ($locked->reply_by === null) {
                throw ValidationException::withMessages(['reply_by' => ['Set the reply-by date before sending.']]);
            }

            $locked->forceFill(['status' => RfqStatus::Sent, 'sent_at' => now()])->save();
            $issued = $this->issue($locked, $invited);
            $this->history->rfq($locked, RfqStatus::Draft->value, RfqStatus::Sent->value, sprintf('Sent to %d suppliers (%d by e-mail).', $invited->count(), $issued));
            $this->audit->record('rfq.sent', $locked, ['status' => 'draft'], ['status' => 'sent', 'suppliers' => $invited->count(), 'emailed' => $issued]);

            return $locked;
        });
    }

    /**
     * Issues the request to the given invited suppliers (called inside a transaction).
     *
     * @param  Collection<int, RfqSupplier>  $targets
     * @return int how many were e-mailed
     */
    public function issue(Rfq $rfq, Collection $targets): int
    {
        $contacts = $this->suppliers->contacts($rfq->organization_id, $targets->pluck('supplier_id')->all());
        $letterhead = $this->letterhead->forOrganization($rfq->organization_id);
        $lineCount = $rfq->lines()->count();
        $mails = [];

        foreach ($targets as $target) {
            $contact = $contacts[$target->supplier_id] ?? null;
            $email = $contact['email'] ?? null;
            $valid = $email !== null && filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
            if ($valid) {
                $mails[] = [$email, new RfqRequestMail(
                    organizationName: $letterhead['name'],
                    replyTo: filled($letterhead['email'] ?? null) ? (string) $letterhead['email'] : null,
                    supplierName: $contact['contact_person'] ?: $contact['name'],
                    rfq: [
                        'number' => $rfq->number,
                        'title' => $rfq->title,
                        'reply_by' => $rfq->reply_by?->format('d M Y'),
                        'needed_by' => $rfq->needed_by?->format('d M Y'),
                        'notes' => $rfq->notes,
                        'line_count' => $lineCount,
                    ],
                    filename: RfqDocument::filename($rfq, $contact),
                    pdfBase64: base64_encode($this->document->render($rfq, $target->supplier_id)),
                )];
            }
            $target->forceFill([
                'sent_at' => now(),
                'emailed_at' => $valid ? now() : null,
                'email' => $valid ? $email : null,
            ])->save();
        }

        if ($mails !== []) {
            DB::afterCommit(function () use ($mails) {
                foreach ($mails as [$address, $mail]) {
                    Notification::route('mail', $address)->notify($mail);
                }
            });
        }

        return count($mails);
    }
}
