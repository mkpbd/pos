<?php

namespace App\Modules\Sales\Application\Actions;

use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Sales\Application\Services\ReceiptLinks;
use App\Modules\Sales\Application\Services\SalesContext;
use App\Modules\Sales\Domain\RecipientMask;
use App\Modules\Sales\Infrastructure\Mail\SaleReceiptMail;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SaleReceiptDelivery;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\BangladeshMobile;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Infrastructure\Export\ExportValues;
use App\Modules\Sms\Application\Contracts\SmsSender;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * POS1d: sends a sale's digital receipt by SMS or e-mail, to `$to` or else the sale customer's
 * mobile number / e-mail address.
 *
 * SMS: a Bangladeshi mobile number; the `sale_receipt` template (the store's default language)
 * with the receipt link, queued through SmsSender (purpose `sale_receipt`, related to the sale).
 * `SMS_NOT_READY` (422) when SMS is not set up, `SMS_TEMPLATE_OFF` (422) when the merchant
 * switched the receipt text off. Over the monthly SMS limit the delivery is `skipped`.
 * E-mail: the queued SaleReceiptMail (the receipt in full + the link), sent after commit.
 *
 * At most MAX_SENDS sends per sale (`RECEIPT_SEND_LIMIT`, 422). Each send writes an append-only
 * delivery row and the audit `sale.receipt_sent` — with the recipient masked, never in full.
 */
class SendSaleReceipt
{
    public const MAX_SENDS = 5;

    public function __construct(
        private readonly SalesContext $context,
        private readonly CustomerDirectory $customers,
        private readonly SmsSender $sms,
        private readonly ReceiptLinks $links,
        private readonly StorefrontConfig $storefront,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  'sms'|'email'  $channel
     * @param  Closure(): array<string, mixed>  $receipt  the public receipt view (for the e-mail)
     * @return array{channel: string, recipient_masked: string, status: string}
     *
     * @throws BusinessRuleViolation|ValidationException
     */
    public function __invoke(TenantUser $user, Sale $sale, string $channel, ?string $to, Closure $receipt): array
    {
        $org = $this->context->organizationId();
        $customer = $sale->customer_id === null ? null : ($this->customers->summaries($org, [$sale->customer_id])[$sale->customer_id] ?? null);
        $to = $to !== null && trim($to) !== '' ? trim($to) : null;

        $recipient = $channel === 'sms'
            ? $this->phone($to ?? ($customer['phone'] ?? null))
            : $this->email($to ?? ($customer['email'] ?? null));
        $masked = $channel === 'sms' ? RecipientMask::phone($recipient) : RecipientMask::email($recipient);

        if ($channel === 'sms') {
            if (! $this->sms->ready($org)) {
                throw new BusinessRuleViolation('SMS_NOT_READY', 'Text messages are not set up. Switch SMS on in Settings → SMS.');
            }
            if (! $this->sms->templateEnabled($org, SmsSender::SALE_RECEIPT)) {
                throw new BusinessRuleViolation('SMS_TEMPLATE_OFF', 'The "Sale receipt" text message is switched off in Settings → SMS.');
            }
        }

        return DB::transaction(function () use ($user, $sale, $channel, $recipient, $masked, $customer, $receipt, $org) {
            // One send at a time per sale, so the limit holds.
            Sale::query()->whereKey($sale->id)->lockForUpdate()->first(['id']);
            if (SaleReceiptDelivery::query()->where('sale_id', $sale->id)->count() >= self::MAX_SENDS) {
                throw new BusinessRuleViolation('RECEIPT_SEND_LIMIT', 'This receipt has already been sent '.self::MAX_SENDS.' times.', ['max' => self::MAX_SENDS]);
            }

            $url = $this->links->url($this->links->forSale($sale));
            $messageId = null;
            if ($channel === 'sms') {
                $text = $this->sms->renderTemplate($org, SmsSender::SALE_RECEIPT, $this->locale(), [
                    'name' => $customer['name'] ?? null,
                    'invoice' => $sale->number,
                    'total' => ExportValues::grouped((string) $sale->total, 2),
                    'link' => $url,
                ]);
                $messageId = $this->sms->queue($org, $recipient, SmsSender::SALE_RECEIPT, $text, null, 'sale', $sale->id);
                $status = match ($messageId === null ? null : $this->sms->messageStatus($org, $messageId)) {
                    'queued', 'sent' => 'queued',
                    'skipped' => 'skipped',
                    default => 'failed',
                };
            } else {
                $organizationName = (string) ($this->context->organization()['name'] ?? '');
                Mail::to($recipient)->queue(new SaleReceiptMail($organizationName, $receipt(), $url));
                $status = 'queued';
            }

            $delivery = SaleReceiptDelivery::query()->create([
                'sale_id' => $sale->id,
                'channel' => $channel,
                'recipient_masked' => $masked,
                'sms_message_id' => $messageId,
                'status' => $status,
                'created_by' => $user->getAuthIdentifier(),
                'created_at' => now(),
            ]);
            $this->audit->record('sale.receipt_sent', $sale, [], [
                'channel' => $channel,
                'recipient' => $masked,
                'status' => $status,
            ], ['number' => $sale->number, 'delivery_id' => $delivery->id]);

            return ['channel' => $channel, 'recipient_masked' => $masked, 'status' => $status];
        });
    }

    private function phone(?string $input): string
    {
        if ($input === null || trim($input) === '') {
            throw ValidationException::withMessages(['to' => ['Enter the mobile number to send the receipt to.']]);
        }
        $phone = BangladeshMobile::normalize($input);
        if ($phone === null) {
            throw ValidationException::withMessages(['to' => ['Enter a valid Bangladeshi mobile number (01XXXXXXXXX).']]);
        }

        return $phone;
    }

    private function email(?string $input): string
    {
        if ($input === null || trim($input) === '') {
            throw ValidationException::withMessages(['to' => ['Enter the e-mail address to send the receipt to.']]);
        }
        $email = trim($input);
        Validator::make(['to' => $email], ['to' => ['email:rfc', 'max:254']], ['to.email' => 'Enter a valid e-mail address.'])->validate();

        return $email;
    }

    /** The store's default language for the text (Bangla only while Bangla is on). */
    private function locale(): string
    {
        $settings = $this->storefront->settings();

        return $settings->bangla_enabled && $settings->default_locale === 'bn' ? 'bn' : 'en';
    }
}
