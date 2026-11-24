<?php

namespace App\Modules\Sms\Application\Services;

use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\BangladeshMobile;
use App\Modules\Sms\Application\Contracts\SmsSender;
use App\Modules\Sms\Application\Queries\SmsConfig;
use App\Modules\Sms\Domain\SmsTemplate;
use App\Modules\Sms\Domain\SmsText;
use App\Modules\Sms\Infrastructure\Jobs\SendSmsJob;
use App\Modules\Sms\Infrastructure\Models\SmsMessage;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * BD1a: the SmsSender — stores messages in the log and hands them to SendSmsJob after the
 * surrounding transaction commits. Dedupe keys make a repeated event a no-op; the monthly limit
 * (sent + queued this calendar month, organization time zone) stores further messages as
 * `skipped`.
 */
class SmsMessenger implements SmsSender
{
    public function __construct(
        private readonly SmsConfig $config,
        private readonly TenantContext $tenant,
    ) {}

    public function ready(string $orgId): bool
    {
        return SmsConfig::ready($this->config->settings($orgId));
    }

    public function otpReady(string $orgId): bool
    {
        return SmsConfig::otpReady($this->config->settings($orgId));
    }

    public function queue(
        string $orgId,
        string $phone,
        string $purpose,
        string $text,
        ?string $dedupeKey = null,
        ?string $relatedType = null,
        ?string $relatedId = null,
        ?string $maskedText = null,
    ): ?string {
        $phone = BangladeshMobile::normalize($phone);
        $text = trim($text);
        if ($phone === null || $text === '' || ! in_array($purpose, SmsMessage::PURPOSES, true)) {
            return null;
        }

        $settings = $this->config->settings($orgId);
        if (! SmsConfig::ready($settings)) {
            return null;
        }

        $dedupeKey = $dedupeKey !== null ? mb_substr($dedupeKey, 0, 120) : null;

        return $this->tenant->runAs($orgId, fn () => DB::transaction(function () use ($orgId, $phone, $purpose, $text, $dedupeKey, $relatedType, $relatedId, $maskedText, $settings) {
            if ($dedupeKey !== null && $this->duplicate($orgId, $dedupeKey)) {
                return null;
            }

            $limit = $settings->monthly_limit;
            $overLimit = $limit !== null && $this->config->monthCount($orgId) >= $limit;
            $analysis = SmsText::analyze($text);

            try {
                // A savepoint, so a duplicate key racing in does not abort the caller's transaction.
                $message = DB::transaction(fn () => SmsMessage::query()->create([
                    'organization_id' => $orgId,
                    'to_phone' => $phone,
                    'purpose' => $purpose,
                    'body' => $maskedText !== null ? trim($maskedText) : $text,
                    'segments' => $analysis['segments'],
                    'encoding' => $analysis['encoding'],
                    'driver' => $settings->driver,
                    'status' => $overLimit ? 'skipped' : 'queued',
                    'error' => $overLimit ? 'monthly_limit' : null,
                    'dedupe_key' => $dedupeKey,
                    'related_type' => $relatedType,
                    'related_id' => $relatedId,
                ]));
            } catch (UniqueConstraintViolationException) {
                return null;
            }

            if (! $overLimit) {
                // The real text travels only in the (encrypted) job when the log keeps a masked copy.
                SendSmsJob::dispatch($message->id, $orgId, $maskedText !== null ? $text : null)->afterCommit();
            }

            return $message->id;
        }));
    }

    public function orderEvent(string $orgId, string $event, string $phone, string $locale, array $vars, string $orderId): void
    {
        if (! in_array($event, self::ORDER_EVENTS, true)) {
            return;
        }

        $settings = $this->config->settings($orgId);
        if (! SmsConfig::ready($settings)) {
            return;
        }

        $template = SmsTemplate::effective($settings->templates)[$event];
        if (! $template['enabled']) {
            return;
        }

        $vars['shop'] = isset($vars['shop']) && trim((string) $vars['shop']) !== '' ? $vars['shop'] : $this->config->shopName($orgId);
        $text = SmsTemplate::render(SmsTemplate::textFor($event, $template, $locale), $vars);

        $this->queue($orgId, $phone, $event, $text, "order:{$orderId}:{$event}", 'order', $orderId);
    }

    private function duplicate(string $orgId, string $dedupeKey): bool
    {
        return SmsMessage::query()->withoutGlobalScope('organization')
            ->where('organization_id', $orgId)->where('dedupe_key', $dedupeKey)->exists();
    }
}
