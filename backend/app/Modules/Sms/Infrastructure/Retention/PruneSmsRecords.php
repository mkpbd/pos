<?php

namespace App\Modules\Sms\Infrastructure\Retention;

use App\Modules\Shared\Application\Contracts\RetentionTask;
use App\Modules\Sms\Infrastructure\Models\SmsMessage;
use App\Modules\Sms\Infrastructure\Models\SmsOtp;

/**
 * BD1a: deletes text messages older than `pos.retention.sms_messages` days
 * (POS_RETAIN_SMS_DAYS, default 180; empty or 0 = keep) and one-time codes older than a day
 * (they expire within minutes). Runs inside `pos:prune-records`; reported as `sms_messages`.
 */
final class PruneSmsRecords implements RetentionTask
{
    private const CHUNK = 1000;

    public function name(): string
    {
        return 'sms_messages';
    }

    public function prune(bool $dryRun): ?int
    {
        $otps = SmsOtp::query()->withoutGlobalScopes()->where('created_at', '<', now()->subDay());
        if (! $dryRun) {
            $otps->delete();
        }

        $days = config('pos.retention.sms_messages');
        if ($days === null || $days === '' || ! is_numeric($days) || (int) $days <= 0) {
            return null;
        }

        $old = fn () => SmsMessage::query()->withoutGlobalScopes()->where('created_at', '<', now()->subDays((int) $days));
        if ($dryRun) {
            return $old()->count();
        }

        $deleted = 0;
        do {
            $batch = SmsMessage::query()->withoutGlobalScopes()->whereIn('id', $old()->select('id')->limit(self::CHUNK))->delete();
            $deleted += $batch;
        } while ($batch === self::CHUNK);

        return $deleted;
    }
}
