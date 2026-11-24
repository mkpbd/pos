<?php

namespace App\Modules\Sms\Application\Actions;

use App\Modules\Sms\Application\Data\SmsResult;
use App\Modules\Sms\Application\Data\SmsSettingsData;
use App\Modules\Sms\Application\Queries\SmsConfig;
use App\Modules\Sms\Infrastructure\Gateways\SmsGateways;
use App\Modules\Sms\Infrastructure\Models\SmsMessage;
use Illuminate\Support\Facades\DB;

/**
 * BD1a: sends one queued message with the organization's current settings (in tenant context).
 * Counts the attempt, records the driver and the gateway's answer and marks the message `sent`
 * or `failed` — a retryable failure that is not the final attempt keeps it `queued` (the job
 * tries again). Returns null when the message is not queued (already handled).
 */
class DeliverSmsMessage
{
    public function __construct(
        private readonly SmsConfig $config,
        private readonly SmsGateways $gateways,
    ) {}

    /**
     * @param  ?string  $text  the real text when the stored body is masked (one-time codes)
     */
    public function __invoke(string $messageId, ?string $text, bool $finalAttempt): ?SmsResult
    {
        /** @var SmsMessage|null $message */
        $message = DB::transaction(function () use ($messageId) {
            $message = SmsMessage::query()->whereKey($messageId)->lockForUpdate()->first();
            if ($message === null || $message->status !== 'queued') {
                return null;
            }
            $message->forceFill(['attempts' => $message->attempts + 1])->save();

            return $message;
        });
        if ($message === null) {
            return null;
        }

        $settings = $this->config->settings($message->organization_id);
        if (! SmsConfig::ready($settings)) {
            $result = SmsResult::failed('sms_disabled');
        } else {
            $result = $this->gateways->for($settings->driver)
                ->send(SmsSettingsData::fromModel($settings), $message->to_phone, $text ?? $message->body, $message->purpose);
        }

        $retryLater = ! $result->ok && $result->retryable && ! $finalAttempt;
        $message->forceFill([
            'driver' => $settings->driver,
            'status' => $result->ok ? 'sent' : ($retryLater ? 'queued' : 'failed'),
            'error' => $result->ok ? null : mb_substr((string) $result->error, 0, 255),
            'provider_status' => $result->providerStatus !== null && $result->providerStatus >= 0 && $result->providerStatus <= 32767 ? $result->providerStatus : null,
            'provider_response' => $result->response !== null ? mb_substr($result->response, 0, 500) : null,
            'sent_at' => $result->ok ? now() : null,
        ])->save();

        return $result;
    }
}
