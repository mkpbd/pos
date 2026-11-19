<?php

namespace App\Modules\Marketing\Application\Queries;

use App\Modules\Marketing\Application\Contracts\AttributedOrders;
use App\Modules\Marketing\Application\Contracts\PageInsightDocuments;
use App\Modules\Marketing\Domain\WebVitals;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * B15: what works on a store builder page, for a range of calendar days in the organization's
 * time zone and optionally one device — from the daily page, section, click grid and Web Vitals
 * counts (RecordPageEvents) and the orders attributed to the page (`attribution.builder`,
 * cancelled and failed orders left out). Rates are percentages 0–100 as strings with two
 * decimals (null when there is nothing to divide by); money as NUMERIC strings in the
 * organization's currency. Unique visitors over a range are the sum of the daily unique visitors.
 */
class PageInsights
{
    public const DEFAULT_DAYS = 30;

    public const MAX_DAYS = 365;

    public const HEAT_CELLS = 400;

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
        private readonly PageInsightDocuments $documents,
        private readonly AttributedOrders $orders,
    ) {}

    /**
     * The organization's time zone and today's date there.
     *
     * @return array{timezone: string, today: string}
     */
    public function today(): array
    {
        $timezone = $this->organization()['timezone'];

        return ['timezone' => $timezone, 'today' => CarbonImmutable::now($timezone)->toDateString()];
    }

    /**
     * One page's insights, or null when the document is not a tracked page of this store.
     *
     * @return array<string, mixed>|null
     */
    public function document(string $documentId, string $from, string $to, ?string $device): ?array
    {
        $document = $this->documents->describe($documentId);
        if ($document === null) {
            return null;
        }
        ['timezone' => $timezone, 'currency' => $currency] = $this->organization();
        [$start, $end] = $this->instants($from, $to, $timezone);
        $id = $document['id'];

        $pages = $this->stats('builder_page_stats', $id, $from, $to, $device)
            ->groupBy('day')->select('day')
            ->selectRaw('SUM(views) AS views, SUM(unique_visitors) AS unique_visitors, SUM(scroll_25) AS s25, SUM(scroll_50) AS s50, SUM(scroll_75) AS s75, SUM(scroll_100) AS s100')
            ->get();
        $sectionRows = $this->stats('builder_section_stats', $id, $from, $to, $device)
            ->groupBy('node_id')->select('node_id')->selectRaw('SUM(views) AS views, SUM(clicks) AS clicks')
            ->get()->keyBy('node_id');
        $cellRows = $this->stats('builder_click_cells', $id, $from, $to, $device)
            ->groupBy('node_id', 'cx', 'cy')->select('node_id', 'cx', 'cy')->selectRaw('SUM(clicks) AS clicks')
            ->orderByDesc('clicks')->orderBy('node_id')->orderBy('cy')->orderBy('cx')
            ->get();
        $vitalRows = $this->stats('builder_vital_buckets', $id, $from, $to, $device)
            ->groupBy('metric', 'bucket')->select('metric', 'bucket')->selectRaw('SUM(samples) AS samples')
            ->get();
        $orders = $this->orders->builderGroups($start, $end, $timezone, $id, $device);

        // Days.
        $daily = [];
        for ($day = CarbonImmutable::parse($from); $day->lte(CarbonImmutable::parse($to)); $day = $day->addDay()) {
            $daily[$day->toDateString()] = ['day' => $day->toDateString(), 'views' => 0, 'unique_visitors' => 0, 'orders' => 0, 'revenue' => '0.00'];
        }
        $totals = ['views' => 0, 'unique_visitors' => 0, 's25' => 0, 's50' => 0, 's75' => 0, 's100' => 0];
        foreach ($pages as $row) {
            $day = self::date($row->day);
            foreach (array_keys($totals) as $field) {
                $totals[$field] += (int) $row->{$field};
            }
            if (isset($daily[$day])) {
                $daily[$day]['views'] += (int) $row->views;
                $daily[$day]['unique_visitors'] += (int) $row->unique_visitors;
            }
        }
        $orderCount = 0;
        $revenue = '0.00';
        $sectionOrders = [];
        foreach ($orders as $row) {
            $orderCount += $row['orders'];
            $revenue = Decimal::add($revenue, $row['revenue'], 2);
            if (isset($daily[$row['day']])) {
                $daily[$row['day']]['orders'] += $row['orders'];
                $daily[$row['day']]['revenue'] = Decimal::add($daily[$row['day']]['revenue'], $row['revenue'], 2);
            }
            if ($row['node_id'] !== null) {
                $node = $row['node_id'];
                $sectionOrders[$node] ??= ['orders' => 0, 'revenue' => '0.00'];
                $sectionOrders[$node]['orders'] += $row['orders'];
                $sectionOrders[$node]['revenue'] = Decimal::add($sectionOrders[$node]['revenue'], $row['revenue'], 2);
            }
        }
        $views = $totals['views'];

        // Sections: the live version's in page order, then those with figures that are no longer live.
        $draftLabels = [];
        foreach ($document['draft_sections'] as $section) {
            $draftLabels[$section['node_id']] = $section;
        }
        $list = [];
        foreach ($document['sections'] as $section) {
            $list[$section['node_id']] = $section + ['live' => true];
        }
        foreach ([...$sectionRows->keys()->all(), ...array_keys($sectionOrders)] as $node) {
            $node = (string) $node;
            if (! isset($list[$node])) {
                $list[$node] = ['node_id' => $node, 'label' => $draftLabels[$node]['label'] ?? null, 'type' => $draftLabels[$node]['type'] ?? 'section', 'live' => false];
            }
        }
        $sections = [];
        $clicks = 0;
        foreach ($list as $node => $section) {
            $row = $sectionRows->get($node);
            $sectionViews = (int) ($row->views ?? 0);
            $sectionClicks = (int) ($row->clicks ?? 0);
            $clicks += $sectionClicks;
            $sections[] = [
                'node_id' => (string) $node,
                'label' => $section['label'],
                'type' => $section['type'],
                'views' => $sectionViews,
                'view_rate' => self::percent($sectionViews, $views),
                'clicks' => $sectionClicks,
                'click_rate' => self::percent($sectionClicks, $sectionViews),
                'orders' => $sectionOrders[$node]['orders'] ?? 0,
                'revenue' => $sectionOrders[$node]['revenue'] ?? '0.00',
                'reach' => null,
                'live' => $section['live'],
            ];
        }
        // Reach: a page view that saw a section further down got past this one too.
        $deepest = 0;
        for ($i = count($sections) - 1; $i >= 0; $i--) {
            if ($sections[$i]['live']) {
                $deepest = max($deepest, $sections[$i]['views']);
                $sections[$i]['reach'] = self::percent($deepest, $views);
            } else {
                $sections[$i]['reach'] = $sections[$i]['view_rate'];
            }
        }

        $heat = [];
        foreach ($cellRows as $cell) {
            $node = (string) $cell->node_id;
            if (count($heat[$node] ?? []) < self::HEAT_CELLS) {
                $heat[$node][] = [(int) $cell->cx, (int) $cell->cy, (int) $cell->clicks];
            }
        }

        $histograms = [];
        foreach ($vitalRows as $row) {
            $histograms[(string) $row->metric][(int) $row->bucket] = (int) $row->samples;
        }
        $vitals = ['rating' => [], 'samples' => []];
        foreach (WebVitals::METRICS_LIST as $metric) {
            $p75 = WebVitals::p75($histograms[$metric] ?? []);
            $vitals[$metric.'_p75'] = $p75 === null ? null : WebVitals::value($metric, $p75);
            $vitals['rating'][$metric] = $p75 === null ? null : WebVitals::rating($metric, $p75);
            $vitals['samples'][$metric] = array_sum($histograms[$metric] ?? []);
        }

        $versions = array_values(array_filter($document['versions'], function (array $version) use ($start, $end) {
            $at = $version['published_at'] === null ? null : CarbonImmutable::parse($version['published_at']);

            return $at !== null && $at->gte($start) && $at->lt($end);
        }));

        return [
            'document' => ['id' => $id, 'title' => $document['title'], 'kind' => $document['kind'], 'key' => $document['key']],
            'from' => $from,
            'to' => $to,
            'device' => $device,
            'timezone' => $timezone,
            'currency' => $currency,
            'totals' => [
                'views' => $views,
                'unique_visitors' => $totals['unique_visitors'],
                // Page views below 25 % count as 0, so this is a lower bound.
                'avg_scroll' => $views > 0 ? Decimal::round(Decimal::div((string) min(100 * $views, 25 * ($totals['s25'] + $totals['s50'] + $totals['s75'] + $totals['s100'])), (string) $views, 4), 2) : null,
                'clicks' => $clicks,
                'orders' => $orderCount,
                'revenue' => $revenue,
                'conversion' => self::percent($orderCount, $totals['unique_visitors']),
                'scroll_reach' => [
                    '25' => self::percent($totals['s25'], $views),
                    '50' => self::percent($totals['s50'], $views),
                    '75' => self::percent($totals['s75'], $views),
                    '100' => self::percent($totals['s100'], $views),
                ],
                'vitals' => [
                    'lcp_p75' => $vitals['lcp_p75'],
                    'cls_p75' => $vitals['cls_p75'],
                    'inp_p75' => $vitals['inp_p75'],
                    'rating' => $vitals['rating'],
                    'samples' => $vitals['samples'],
                ],
            ],
            'daily' => array_values($daily),
            'sections' => $sections,
            'heat' => $heat === [] ? (object) [] : $heat,
            'versions' => $versions,
        ];
    }

    /**
     * Views and orders of every tracked page of the store that has any in the range.
     *
     * @return array<string, mixed>
     */
    public function summary(string $from, string $to): array
    {
        ['timezone' => $timezone, 'currency' => $currency] = $this->organization();
        [$start, $end] = $this->instants($from, $to, $timezone);

        $figures = [];
        $zero = ['views' => 0, 'unique_visitors' => 0, 'orders' => 0, 'revenue' => '0.00'];
        $rows = $this->stats('builder_page_stats', null, $from, $to, null)
            ->groupBy('document_id')->select('document_id')->selectRaw('SUM(views) AS views, SUM(unique_visitors) AS unique_visitors')
            ->get();
        foreach ($rows as $row) {
            $figures[(string) $row->document_id] = ['views' => (int) $row->views, 'unique_visitors' => (int) $row->unique_visitors] + $zero;
        }
        foreach ($this->orders->builderGroups($start, $end, $timezone) as $row) {
            $figures[$row['document_id']] ??= $zero;
            $figures[$row['document_id']]['orders'] += $row['orders'];
            $figures[$row['document_id']]['revenue'] = Decimal::add($figures[$row['document_id']]['revenue'], $row['revenue'], 2);
        }
        $existing = array_flip($this->documents->existing(array_map('strval', array_keys($figures))));

        $documents = [];
        foreach ($figures as $id => $f) {
            if (isset($existing[$id])) {
                $documents[] = ['document_id' => (string) $id, ...$f, 'conversion' => self::percent($f['orders'], $f['unique_visitors'])];
            }
        }
        usort($documents, fn (array $a, array $b) => ($b['views'] <=> $a['views']) ?: ($b['orders'] <=> $a['orders']) ?: strcmp($a['document_id'], $b['document_id']));

        return ['from' => $from, 'to' => $to, 'timezone' => $timezone, 'currency' => $currency, 'documents' => $documents];
    }

    /**
     * The organization's counts of a table in the range (one document and device when given).
     */
    private function stats(string $table, ?string $documentId, string $from, string $to, ?string $device): Builder
    {
        return DB::table($table)
            ->where('organization_id', $this->tenant->requireOrganization())
            ->when($documentId !== null, fn (Builder $q) => $q->where('document_id', $documentId))
            ->whereBetween('day', [$from, $to])
            ->when($device !== null, fn (Builder $q) => $q->where('device', $device));
    }

    /**
     * @return array{timezone: string, currency: string}
     */
    private function organization(): array
    {
        $organization = $this->organizations->summary($this->tenant->requireOrganization()) ?? [];

        return [
            'timezone' => (string) ($organization['timezone'] ?? config('app.timezone')),
            'currency' => (string) ($organization['base_currency'] ?? config('pos.default_currency')),
        ];
    }

    /**
     * The first instant of `from` and the first after `to` in the time zone.
     *
     * @return array{0: CarbonImmutable, 1: CarbonImmutable}
     */
    private function instants(string $from, string $to, string $timezone): array
    {
        return [CarbonImmutable::parse($from, $timezone)->startOfDay(), CarbonImmutable::parse($to, $timezone)->startOfDay()->addDay()];
    }

    private static function date(mixed $day): string
    {
        return substr((string) $day, 0, 10);
    }

    private static function percent(int $part, int $whole): ?string
    {
        return $whole > 0 ? Decimal::round(Decimal::div((string) ($part * 100), (string) $whole, 4), 2) : null;
    }
}
