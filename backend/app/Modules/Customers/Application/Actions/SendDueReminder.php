<?php

namespace App\Modules\Customers\Application\Actions;

use App\Modules\Customers\Application\Services\DueReminders;
use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\BangladeshMobile;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Sms\Application\Contracts\SmsSender;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * R1: sends a customer's due reminder by SMS now (whatever the reminder schedule). A
 * Bangladeshi mobile number (validation error on `phone`) and something owed (`NO_DUE`) are
 * required; `SMS_NOT_READY` when SMS is not set up, `SMS_TEMPLATE_OFF` when the merchant switched
 * the text off. Audited as `customer.due_reminder_sent` with the number masked.
 */
class SendDueReminder
{
    public function __construct(
        private readonly DueReminders $reminders,
        private readonly SmsSender $sms,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @return array{recipient_masked: string, status: string, due: string}
     */
    public function __invoke(Customer $customer): array
    {
        $phone = BangladeshMobile::normalize($customer->phone);
        if ($phone === null) {
            throw ValidationException::withMessages(['phone' => ['This customer has no valid Bangladeshi mobile number.']]);
        }
        $due = $this->reminders->outstanding([$customer])[$customer->id];
        if (Decimal::compare($due, '0') <= 0) {
            throw new BusinessRuleViolation('NO_DUE', 'This customer owes nothing.');
        }
        $organizationId = $customer->organization_id;
        if (! $this->sms->ready($organizationId)) {
            throw new BusinessRuleViolation('SMS_NOT_READY', 'Text messages are not set up. Switch SMS on in Settings → SMS.');
        }
        if (! $this->sms->templateEnabled($organizationId, SmsSender::DUE_REMINDER)) {
            throw new BusinessRuleViolation('SMS_TEMPLATE_OFF', 'The "Due reminder" text message is switched off in Settings → SMS.');
        }

        return DB::transaction(function () use ($customer, $phone, $due, $organizationId) {
            $messageId = $this->reminders->queue($customer, $phone, $due);
            $status = match ($messageId === null ? null : $this->sms->messageStatus($organizationId, $messageId)) {
                'queued', 'sent' => 'queued',
                'skipped' => 'skipped',
                default => 'failed',
            };
            $masked = BangladeshMobile::masked($phone);
            $this->audit->record('customer.due_reminder_sent', $customer, [], ['recipient' => $masked, 'status' => $status, 'due' => $due], ['channel' => 'sms']);

            return ['recipient_masked' => $masked, 'status' => $status, 'due' => $due];
        });
    }
}
