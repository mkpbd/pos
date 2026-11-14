<?php

namespace App\Modules\Marketing\Application\Actions;

use App\Modules\Marketing\Application\Contracts\LandingPages;
use App\Modules\Marketing\Domain\BotUserAgents;
use App\Modules\Marketing\Infrastructure\Models\Campaign;
use App\Modules\Marketing\Infrastructure\Models\ShortLink;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\CampaignAttribution;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * P2a: a storefront visit that arrived with campaign attribution (the storefront sends it once
 * per session): counted per day (organization time zone), campaign, short link, landing path,
 * source and medium. The campaign is the short link's, else the one with the visit's
 * `utm_campaign`, else the one whose landing page is the path. A visit counts when it names a
 * campaign, a short link or a UTM source / campaign; bots (user agent list) never count.
 *
 * Unique visitors without personal data: sha256 of ip + user agent + a random salt that only
 * exists for that day (in the cache), stored per day and bucket and deleted after two days —
 * neither the address nor the browser can be recovered from it.
 */
class RecordVisit
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
        private readonly LandingPages $landingPages,
    ) {}

    /**
     * @param  array<string, mixed>  $input  path, utm_*, code
     */
    public function __invoke(array $input, ?string $ip, ?string $userAgent): bool
    {
        if (BotUserAgents::isBot($userAgent)) {
            return false;
        }
        $path = CampaignAttribution::path($input['path'] ?? null);
        if ($path === null) {
            return false;
        }
        $utm = [];
        foreach (CampaignAttribution::UTM_KEYS as $key) {
            $value = CampaignAttribution::utm($input[$key] ?? null);
            $utm[$key] = $value !== null && in_array($key, CampaignAttribution::LOWERCASE, true) ? mb_strtolower($value) : $value;
        }
        $code = CampaignAttribution::code($input['code'] ?? null);
        $link = $code === null ? null : ShortLink::query()->where('code', $code)->where('active', true)->first();

        $utmCampaign = $utm['utm_campaign'] ?? $link?->utm_campaign;
        $campaignId = $link?->campaign_id
            ?? ($utmCampaign === null ? null : Campaign::query()->where('utm_campaign', $utmCampaign)->value('id'));
        if ($campaignId === null && ($landingId = $this->landingPages->idForPath($path)) !== null) {
            $campaignId = Campaign::query()->where('landing_document_id', $landingId)->where('status', Campaign::STATUS_ACTIVE)->orderBy('created_at')->value('id');
        }
        $source = $utm['utm_source'] ?? $link?->utm_source;
        $medium = $utm['utm_medium'] ?? $link?->utm_medium;
        if ($campaignId === null && $link === null && $source === null && $utmCampaign === null) {
            return false;
        }

        $organizationId = $this->tenant->requireOrganization();
        $timezone = (string) ($this->organizations->summary($organizationId)['timezone'] ?? config('app.timezone'));
        $day = CarbonImmutable::now($timezone)->toDateString();
        $bucket = hash('sha256', implode('|', [$campaignId ?? '', $link?->id ?? '', $path, $source ?? '', $medium ?? '']));
        $salt = Cache::remember('marketing:visit-salt:'.$day, now()->addDays(2), fn () => Str::random(40));
        $visitor = hash('sha256', $salt.'|'.($ip ?? '').'|'.($userAgent ?? ''));
        $now = now();

        DB::transaction(function () use ($organizationId, $day, $bucket, $visitor, $campaignId, $link, $path, $source, $medium, $now) {
            $unique = DB::table('campaign_visitor_hashes')->insertOrIgnore([
                'organization_id' => $organizationId,
                'day' => $day,
                'bucket' => $bucket,
                'hash' => $visitor,
                'created_at' => $now,
            ]);
            DB::statement(
                'INSERT INTO campaign_daily_stats (id, organization_id, day, bucket, campaign_id, short_link_id, path, source, medium, visits, unique_visitors, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
                 ON CONFLICT (organization_id, day, bucket) DO UPDATE SET
                   visits = campaign_daily_stats.visits + 1,
                   unique_visitors = campaign_daily_stats.unique_visitors + excluded.unique_visitors,
                   updated_at = excluded.updated_at',
                [(string) Str::uuid7(), $organizationId, $day, $bucket, $campaignId, $link?->id, $path, $source, $medium, $unique > 0 ? 1 : 0, $now, $now],
            );
        });

        return true;
    }
}
