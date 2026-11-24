<?php

namespace App\Modules\Sms\Application\Queries;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Sms\Infrastructure\Models\SmsMessage;
use App\Modules\Sms\Infrastructure\Models\SmsSettings;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * BD1a: an organization's SMS settings (defaults — off, test mode — as an unsaved model when
 * never saved), whether it can send, the shop name used in messages and this month's usage.
 * Every method takes the organization explicitly (callers may run outside a request).
 */
class SmsConfig
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
        private readonly StorefrontConfig $storefront,
    ) {}

    public function settings(string $organizationId): SmsSettings
    {
        /** @var SmsSettings|null $settings */
        $settings = SmsSettings::query()->withoutGlobalScope('organization')->where('organization_id', $organizationId)->first();

        return $settings ?? new SmsSettings(['organization_id' => $organizationId]);
    }

    /** Enabled and configured: the log driver, or the HTTP driver with an address. */
    public static function ready(SmsSettings $settings): bool
    {
        if (! $settings->is_enabled) {
            return false;
        }

        return $settings->driver === 'log' || ($settings->driver === 'http' && trim((string) $settings->http_url) !== '');
    }

    /** ready() and able to deliver one-time codes (test mode never reaches a phone in production). */
    public static function otpReady(SmsSettings $settings): bool
    {
        return self::ready($settings) && ! ($settings->driver === 'log' && app()->isProduction());
    }

    /**
     * The store's name for {shop}: the storefront's site name, else the organization's name.
     */
    public function shopName(string $organizationId): string
    {
        try {
            $name = $this->tenant->runAs($organizationId, fn () => trim((string) $this->storefront->settings()->site_name));
        } catch (Throwable) {
            $name = '';
        }

        return $name !== '' ? $name : (string) ($this->organizations->summary($organizationId)['name'] ?? '');
    }

    public function timezone(string $organizationId): string
    {
        $timezone = $this->organizations->summary($organizationId)['timezone'] ?? null;

        return is_string($timezone) && $timezone !== '' ? $timezone : (string) config('app.timezone', 'UTC');
    }

    /** Start of the current calendar month in the organization's time zone. */
    public function monthStart(string $organizationId): CarbonImmutable
    {
        return CarbonImmutable::now($this->timezone($organizationId))->startOfMonth()->utc();
    }

    /** Start of today in the organization's time zone. */
    public function dayStart(string $organizationId): CarbonImmutable
    {
        return CarbonImmutable::now($this->timezone($organizationId))->startOfDay()->utc();
    }

    /**
     * This calendar month: messages sent, failed and the SMS parts of the sent ones.
     *
     * @return array{month_sent: int, month_failed: int, month_segments: int}
     */
    public function usage(string $organizationId): array
    {
        $row = SmsMessage::query()->withoutGlobalScope('organization')
            ->where('organization_id', $organizationId)
            ->where('created_at', '>=', $this->monthStart($organizationId))
            ->select([
                DB::raw("count(*) filter (where status = 'sent') as sent"),
                DB::raw("count(*) filter (where status = 'failed') as failed"),
                DB::raw("coalesce(sum(segments) filter (where status = 'sent'), 0) as segments"),
            ])
            ->toBase()->first();

        return [
            'month_sent' => (int) ($row->sent ?? 0),
            'month_failed' => (int) ($row->failed ?? 0),
            'month_segments' => (int) ($row->segments ?? 0),
        ];
    }

    /** Messages that count against the monthly limit (sent or still queued this month). */
    public function monthCount(string $organizationId): int
    {
        return SmsMessage::query()->withoutGlobalScope('organization')
            ->where('organization_id', $organizationId)
            ->whereIn('status', ['sent', 'queued'])
            ->where('created_at', '>=', $this->monthStart($organizationId))
            ->count();
    }
}
