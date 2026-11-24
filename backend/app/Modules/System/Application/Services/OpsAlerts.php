<?php

namespace App\Modules\System\Application\Services;

use App\Modules\System\Infrastructure\Notifications\OpsAlertNotification;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\RateLimiter;

/**
 * G1b: the operations alert channel — queued e-mails to POS_OPS_ALERT_EMAILS, at most
 * MAX_PER_HOUR in total so an error storm cannot flood the inbox.
 */
final class OpsAlerts
{
    public const MAX_PER_HOUR = 20;

    private const LIMITER_KEY = 'system:ops-alerts';

    /**
     * @return list<string>
     */
    public function recipients(): array
    {
        return array_values(array_filter((array) config('pos.ops_alert_emails'), fn ($email) => is_string($email) && $email !== ''));
    }

    /**
     * Whether an alert could go out now (recipients configured, hourly budget left).
     */
    public function canSend(): bool
    {
        return $this->recipients() !== [] && ! RateLimiter::tooManyAttempts(self::LIMITER_KEY, self::MAX_PER_HOUR);
    }

    /**
     * @param  list<string>  $lines
     */
    public function send(string $kind, string $subject, array $lines, ?string $actionUrl = null, ?string $actionText = null): bool
    {
        if (! $this->canSend()) {
            return false;
        }

        RateLimiter::hit(self::LIMITER_KEY, 3600);
        Notification::route('mail', $this->recipients())
            ->notify(new OpsAlertNotification($kind, '['.config('app.name').'] '.$subject, $lines, $actionUrl, $actionText));

        return true;
    }

    public static function adminUrl(string $path): string
    {
        return rtrim((string) config('pos.frontend_url'), '/').'/admin/'.ltrim($path, '/');
    }
}
