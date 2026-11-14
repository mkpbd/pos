<?php

namespace App\Modules\Marketing\Application\Queries;

use App\Modules\Marketing\Application\Contracts\AttributedOrders;
use App\Modules\Marketing\Infrastructure\Models\Campaign;
use App\Modules\Marketing\Infrastructure\Models\CampaignDailyStat;
use App\Modules\Marketing\Infrastructure\Models\ShortLink;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\ValueObjects\Money;
use Carbon\CarbonImmutable;

/**
 * P2a: campaign performance for a date range (calendar days in the organization's time zone):
 * visits and unique visitors (from the daily counts; a visitor counts once per day and landing
 * bucket), orders, items and revenue (cancelled and failed orders left out, counted apart as
 * `cancelled_orders`), conversion rate (orders per 100 unique visitors) and average order value
 * — in total, per campaign (orders that belong to none are "Direct / other", `campaign: null`),
 * per source / medium, per day (every day of the range) and the top landing pages.
 *
 * An order belongs to the campaign of its short link, else to the campaign with its
 * `utm_campaign`. With `$campaignId` everything is restricted to that campaign. Money as
 * NUMERIC strings in the organization's currency.
 */
class CampaignStats
{
    public const MAX_DAYS = 366;

    public const DEFAULT_DAYS = 30;

    public const TOP_PAGES = 10;

    public function __construct(
        private readonly AttributedOrders $orders,
        private readonly OrganizationDirectory $organizations,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * The organization's time zone and today's date there.
     *
     * @return array{timezone: string, today: string}
     */
    public function today(): array
    {
        $timezone = $this->timezone();

        return ['timezone' => $timezone, 'today' => CarbonImmutable::now($timezone)->toDateString()];
    }

    /**
     * @return array<string, mixed>
     */
    public function __invoke(string $from, string $to, ?Campaign $campaign = null): array
    {
        $organization = $this->organizations->summary($this->tenant->requireOrganization()) ?? [];
        $timezone = $this->timezone();
        $currency = (string) ($organization['base_currency'] ?? config('pos.default_currency'));
        $start = CarbonImmutable::parse($from, $timezone)->startOfDay();
        $end = CarbonImmutable::parse($to, $timezone)->startOfDay()->addDay();

        $campaigns = Campaign::query()->orderBy('name')->get(['id', 'name', 'status', 'utm_campaign'])->keyBy('id');
        $byTag = $campaigns->keyBy('utm_campaign');
        $linkCampaigns = ShortLink::query()->whereNotNull('campaign_id')->pluck('campaign_id', 'code')->all();

        $zero = fn () => ['visits' => 0, 'unique_visitors' => 0, 'orders' => 0, 'cancelled_orders' => 0, 'items' => '0', 'revenue' => '0'];
        $totals = $zero();
        $perCampaign = [];
        $perSource = [];
        $perDay = [];
        $perPage = [];
        for ($day = $start; $day->lt($end); $day = $day->addDay()) {
            $perDay[$day->toDateString()] = $zero();
        }
        $add = function (array &$bucket, array $values) {
            $bucket['visits'] += $values['visits'] ?? 0;
            $bucket['unique_visitors'] += $values['unique_visitors'] ?? 0;
            $bucket['orders'] += $values['orders'] ?? 0;
            $bucket['cancelled_orders'] += $values['cancelled_orders'] ?? 0;
            $bucket['items'] = Decimal::add($bucket['items'], $values['items'] ?? '0', 3);
            $bucket['revenue'] = Decimal::add($bucket['revenue'], $values['revenue'] ?? '0', 2);
        };
        $record = function (?string $campaignId, string $day, ?string $source, ?string $medium, ?string $path, array $values) use (&$totals, &$perCampaign, &$perSource, &$perDay, &$perPage, $add, $zero, $campaign) {
            if ($campaign !== null && $campaignId !== $campaign->id) {
                return;
            }
            $add($totals, $values);
            $key = $campaignId ?? '';
            $perCampaign[$key] ??= $zero();
            $add($perCampaign[$key], $values);
            $sourceKey = ($source ?? '')."\n".($medium ?? '');
            $perSource[$sourceKey] ??= ['source' => $source, 'medium' => $medium] + $zero();
            $add($perSource[$sourceKey], $values);
            if (isset($perDay[$day])) {
                $add($perDay[$day], $values);
            }
            if ($path !== null) {
                $perPage[$path] ??= ['path' => $path] + $zero();
                $add($perPage[$path], $values);
            }
        };

        $visitRows = CampaignDailyStat::query()
            ->where('day', '>=', $start->toDateString())
            ->where('day', '<', $end->toDateString())
            ->when($campaign !== null, fn ($q) => $q->where('campaign_id', $campaign->id))
            ->selectRaw("campaign_id, to_char(day, 'YYYY-MM-DD') AS day_text, source, medium, path, SUM(visits) AS visits, SUM(unique_visitors) AS uniques")
            ->groupByRaw('campaign_id, day, source, medium, path')
            ->toBase()
            ->get();
        foreach ($visitRows as $row) {
            $record($row->campaign_id, (string) $row->day_text, $row->source, $row->medium, $row->path, [
                'visits' => (int) $row->visits,
                'unique_visitors' => (int) $row->uniques,
            ]);
        }

        foreach ($this->orders->groups($start, $end, $timezone) as $group) {
            $campaignId = null;
            if ($group['short_link'] !== null && isset($linkCampaigns[$group['short_link']])) {
                $campaignId = $linkCampaigns[$group['short_link']];
            } elseif ($group['utm_campaign'] !== null && $byTag->has($group['utm_campaign'])) {
                $campaignId = $byTag->get($group['utm_campaign'])->id;
            }
            $record($campaignId, $group['day'], $group['source'], $group['medium'], $group['landing_path'], $group['lost']
                ? ['cancelled_orders' => $group['orders']]
                : ['orders' => $group['orders'], 'items' => $group['items'], 'revenue' => $group['revenue']]);
        }

        $present = fn (array $b) => [
            'visits' => $b['visits'],
            'unique_visitors' => $b['unique_visitors'],
            'orders' => $b['orders'],
            'cancelled_orders' => $b['cancelled_orders'],
            'items' => self::quantity($b['items']),
            'revenue' => Money::of($b['revenue'], $currency)->amount(),
            'conversion_rate' => $b['unique_visitors'] > 0 ? Decimal::round(Decimal::div((string) ($b['orders'] * 100), (string) $b['unique_visitors'], 4), 2) : null,
            'average_order_value' => $b['orders'] > 0 ? Money::of(Decimal::round(Decimal::div($b['revenue'], (string) $b['orders'], 4), 2), $currency)->amount() : null,
        ];

        $byCampaign = [];
        if ($campaign === null) {
            // Every running campaign (also without activity), the archived ones with activity, then direct.
            foreach ($campaigns as $id => $c) {
                if ($c->status === Campaign::STATUS_ACTIVE || isset($perCampaign[$id])) {
                    $byCampaign[] = ['campaign' => ['id' => $c->id, 'name' => $c->name, 'status' => $c->status]] + $present($perCampaign[$id] ?? $zero());
                }
            }
            usort($byCampaign, fn (array $a, array $b) => Decimal::compare($b['revenue'], $a['revenue']) ?: ($b['visits'] <=> $a['visits']) ?: strcmp($a['campaign']['name'], $b['campaign']['name']));
            $byCampaign[] = ['campaign' => null] + $present($perCampaign[''] ?? $zero());
        }

        $sources = array_map(fn (array $b) => ['source' => $b['source'], 'medium' => $b['medium']] + array_intersect_key($present($b), array_flip(['visits', 'unique_visitors', 'orders', 'items', 'revenue'])), array_values($perSource));
        usort($sources, fn (array $a, array $b) => ($b['orders'] <=> $a['orders']) ?: ($b['visits'] <=> $a['visits']) ?: strcmp((string) $a['source'], (string) $b['source']));

        $pages = array_map(fn (array $b) => ['path' => $b['path']] + array_intersect_key($present($b), array_flip(['visits', 'orders', 'revenue'])), array_values($perPage));
        usort($pages, fn (array $a, array $b) => ($b['orders'] <=> $a['orders']) ?: ($b['visits'] <=> $a['visits']) ?: strcmp($a['path'], $b['path']));

        $days = [];
        foreach ($perDay as $date => $b) {
            $days[] = ['date' => $date] + array_intersect_key($present($b), array_flip(['visits', 'unique_visitors', 'orders', 'revenue']));
        }

        return [
            'range' => ['from' => $start->toDateString(), 'to' => $end->subDay()->toDateString(), 'timezone' => $timezone],
            'currency' => $currency,
            'campaign' => $campaign === null ? null : ['id' => $campaign->id, 'name' => $campaign->name],
            'totals' => $present($totals),
            'by_campaign' => $byCampaign,
            'by_source' => $sources,
            'by_day' => $days,
            'top_landing_pages' => array_slice($pages, 0, self::TOP_PAGES),
        ];
    }

    private function timezone(): string
    {
        return (string) ($this->organizations->summary($this->tenant->requireOrganization())['timezone'] ?? config('app.timezone'));
    }

    /**
     * A quantity without trailing zeros ("12", "2.5").
     */
    private static function quantity(string $value): string
    {
        return str_contains($value, '.') ? rtrim(rtrim($value, '0'), '.') : $value;
    }
}
