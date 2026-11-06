<?php

namespace App\Modules\Reports\Application\Dashboard;

use App\Modules\Organizations\Application\Support\OrganizationDate;
use App\Modules\Reports\Application\ReportContext;
use App\Modules\Reports\Application\ReportRunner;
use App\Modules\Reports\Application\Reports\ProfitAndLossReport;
use App\Modules\Reports\Application\Support\LowStock;
use App\Modules\Reports\Application\Support\Names;
use App\Modules\Reports\Application\Support\SalesFacts;
use App\Modules\Reports\Application\Support\Sql;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Domain\ReportGroup;
use App\Modules\Reports\Domain\ReportParam;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Auth\Access\Authorizable;
use Illuminate\Contracts\Cache\Repository as Cache;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * The dashboard (Phase 7): KPIs with the previous period, the daily sales trend (POS vs
 * online), top products, low stock, recent transactions and sales by channel / branch — all
 * from the same SalesFacts definitions as the reports, in the user's branch scope.
 *
 * Range: `date_from`..`date_to` (organization dates; default the last 30 days up to today, at
 * most 366 days); the previous period is the same number of days just before. `today_revenue`
 * is always today's net sales (previous: yesterday).
 *
 * Cached for 60 seconds per organization × branch scope (the sorted list of branches the
 * query reads, never one user's cache served to a user with other branches) × range × day ×
 * what the user may see (cost, web orders) — a short, version-agnostic TTL.
 */
final class Dashboard
{
    public const CACHE_SECONDS = 60;

    public const CACHE_PREFIX = 'reports:dashboard:v1';

    public function __construct(
        private readonly ReportRunner $runner,
        private readonly SalesFacts $facts,
        private readonly LowStock $lowStock,
        private readonly Cache $cache,
        private readonly OrganizationDate $dates,
    ) {}

    public static function definition(): ReportDefinition
    {
        return new ReportDefinition(
            key: 'dashboard',
            title: 'Dashboard',
            description: 'Sales KPIs, trend, top products, low stock and recent transactions.',
            group: ReportGroup::Sales,
            permission: 'dashboard.view',
            params: [new ReportParam('date_from', 'From', 'date'), new ReportParam('date_to', 'To', 'date'), ReportParam::branch()],
            columns: [],
            defaultSort: null,
            granularity: 'day',
        );
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{data: array<string, mixed>, meta: array<string, mixed>}
     */
    public function build(TenantUser&Authorizable $user, array $input): array
    {
        $today = $this->dates->today();
        $input = array_filter($input, fn ($v) => $v !== null && $v !== '');
        $input['date_to'] ??= $today;
        if (! isset($input['date_from']) && is_string($input['date_to']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $input['date_to']) === 1) {
            $input['date_from'] = CarbonImmutable::parse($input['date_to'])->subDays(29)->toDateString();
        }
        $context = $this->runner->context(self::definition(), $input, $user);

        $canViewCost = $user->can('products.view_cost');
        $canViewWeb = $user->can('web_orders.view');
        $branches = $context->branchIds;
        if ($branches !== null) {
            sort($branches);
        }
        $scope = $branches === null ? 'all' : implode(',', $branches);
        $key = implode(':', [self::CACHE_PREFIX, $context->organizationId, hash('sha256', $scope), $context->from(), $context->to(), $today, (int) $canViewCost, (int) $canViewWeb]);

        return $this->cache->remember($key, self::CACHE_SECONDS, fn () => $this->compute($context, $canViewCost, $canViewWeb));
    }

    /**
     * @return array{data: array<string, mixed>, meta: array<string, mixed>}
     */
    private function compute(ReportContext $context, bool $canViewCost, bool $canViewWeb): array
    {
        $previous = ProfitAndLossReport::previousPeriod($context->from(), $context->to());
        $today = $context->today();
        $yesterday = CarbonImmutable::parse($today)->subDay()->toDateString();

        $current = $this->facts->totals($context);
        $before = $this->facts->totals($context, $previous['date_from'], $previous['date_to']);
        $todayTotals = $this->facts->totals($context, $today, $today);
        $yesterdayTotals = $this->facts->totals($context, $yesterday, $yesterday);

        $kpi = fn (string $value, string $previousValue) => [
            'value' => $value,
            'previous' => $previousValue,
            'change' => Decimal::sub($value, $previousValue, 2),
            'change_pct' => Decimal::isZero($previousValue) ? null : Sql::percent(Decimal::sub($value, $previousValue, 2), ltrim($previousValue, '-')),
        ];
        $average = fn (array $t) => $t['orders'] > 0 ? Decimal::div($t['net_sales'], (string) $t['orders'], 2) : '0.00';
        $kpis = [
            'total_sales' => $kpi($current['net_sales'], $before['net_sales']),
            'today_revenue' => $kpi($todayTotals['net_sales'], $yesterdayTotals['net_sales']),
            'orders_count' => [
                'value' => $current['orders'],
                'previous' => $before['orders'],
                'change' => $current['orders'] - $before['orders'],
                'change_pct' => $before['orders'] === 0 ? null : Sql::percent((string) ($current['orders'] - $before['orders']), (string) $before['orders']),
            ],
            'gross_profit' => $canViewCost ? $kpi($current['gross_profit'], $before['gross_profit']) : null,
            'average_ticket' => $kpi($average($current), $average($before)),
            'returns_amount' => $kpi($current['returns'], $before['returns']),
        ];

        [$trend, $channels] = $this->trend($context, $canViewCost);
        $lowStock = $this->lowStock->rows($context);
        usort($lowStock, fn (array $a, array $b) => Decimal::compare($b['shortfall'], $a['shortfall']));

        return [
            'data' => [
                'kpis' => $kpis,
                'sales_trend' => $trend,
                'top_products' => $this->topProducts($context),
                'low_stock' => ['count' => count($lowStock), 'items' => $this->lowStockItems($context, array_slice($lowStock, 0, 10))],
                'recent_transactions' => $this->recent($context, $canViewWeb),
                'sales_by_channel' => $channels,
                'sales_by_branch' => $this->byBranch($context),
            ],
            'meta' => [
                'params' => [
                    'date_from' => $context->from(),
                    'date_to' => $context->to(),
                    'branch_id' => $context->param('branch_id'),
                    'previous_from' => $previous['date_from'],
                    'previous_to' => $previous['date_to'],
                    'today' => $today,
                    'timezone' => $context->timezone,
                    'currency' => $context->currency,
                ],
                'generated_at' => CarbonImmutable::now($context->timezone)->toIso8601String(),
                'omitted' => $canViewCost ? [] : ['gross_profit'],
                'cache_seconds' => self::CACHE_SECONDS,
            ],
        ];
    }

    /**
     * Daily points over the range (every day, zeros included) and the channel split.
     *
     * @return array{0: list<array<string, mixed>>, 1: list<array<string, mixed>>}
     */
    private function trend(ReportContext $context, bool $canViewCost): array
    {
        $byDay = [];
        $channels = ['pos' => ['net_sales' => '0.00', 'orders' => 0], 'online' => ['net_sales' => '0.00', 'orders' => 0]];
        foreach ($this->facts->aggregate($context, ['day', 'channel']) as $agg) {
            $byDay[$agg['day']][$agg['channel']] = $agg;
            $channels[$agg['channel']]['net_sales'] = Decimal::add($channels[$agg['channel']]['net_sales'], $agg['net_sales'], 2);
            $channels[$agg['channel']]['orders'] += $agg['orders'];
        }

        $points = [];
        $last = CarbonImmutable::parse($context->to());
        for ($day = CarbonImmutable::parse($context->from()); $day <= $last; $day = $day->addDay()) {
            $date = $day->toDateString();
            $pos = $byDay[$date]['pos'] ?? null;
            $online = $byDay[$date]['online'] ?? null;
            $point = [
                'date' => $date,
                'net_sales' => Decimal::add($pos['net_sales'] ?? '0', $online['net_sales'] ?? '0', 2),
                'pos_net_sales' => Decimal::round($pos['net_sales'] ?? '0', 2),
                'online_net_sales' => Decimal::round($online['net_sales'] ?? '0', 2),
                'orders' => ($pos['orders'] ?? 0) + ($online['orders'] ?? 0),
                'pos_orders' => $pos['orders'] ?? 0,
                'online_orders' => $online['orders'] ?? 0,
            ];
            if ($canViewCost) {
                $point['gross_profit'] = Decimal::add($pos['gross_profit'] ?? '0', $online['gross_profit'] ?? '0', 2);
            }
            $points[] = $point;
        }

        $total = Decimal::add($channels['pos']['net_sales'], $channels['online']['net_sales'], 2);
        $split = [];
        foreach (['pos' => 'POS', 'online' => 'Online'] as $channel => $label) {
            $split[] = [
                'channel' => $channel,
                'label' => $label,
                'net_sales' => $channels[$channel]['net_sales'],
                'orders' => $channels[$channel]['orders'],
                'share' => Sql::percent($channels[$channel]['net_sales'], $total),
            ];
        }

        return [$points, $split];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function topProducts(ReportContext $context): array
    {
        $rows = $this->facts->aggregate($context, ['product']);
        usort($rows, fn (array $a, array $b) => Decimal::compare($b['net_sales'], $a['net_sales']) ?: Decimal::compare($b['quantity'], $a['quantity']));
        $rows = array_slice(array_values(array_filter($rows, fn (array $r) => Decimal::compare($r['net_sales'], '0') > 0 || Decimal::compare($r['quantity'], '0') > 0)), 0, 10);
        $names = Names::of('product', $context->organizationId, array_column($rows, 'product'));

        return array_map(fn (array $r) => [
            'product_id' => $r['product'],
            'name' => $names[$r['product']] ?? 'Unknown product',
            'quantity' => $r['quantity'],
            'net_sales' => $r['net_sales'],
            'orders' => $r['orders'],
        ], $rows);
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @return list<array<string, mixed>>
     */
    private function lowStockItems(ReportContext $context, array $rows): array
    {
        $variants = DB::table('product_variants as pv')->join('products as p', 'p.id', '=', 'pv.product_id')
            ->where('pv.organization_id', $context->organizationId)->whereIn('pv.id', array_column($rows, 'variant_id'))
            ->get(['pv.id', 'pv.sku', 'pv.name as variant_name', 'p.id as product_id', 'p.name as product_name'])->keyBy('id');
        $stores = Names::of('store', $context->organizationId, array_column($rows, 'store_id'));

        return array_map(function (array $r) use ($variants, $stores) {
            $v = $variants[$r['variant_id']] ?? null;

            return [
                'variant_id' => $r['variant_id'],
                'product_id' => $v->product_id ?? null,
                'product' => $v === null ? 'Unknown product' : ($v->variant_name !== null && $v->variant_name !== '' ? $v->product_name.' — '.$v->variant_name : $v->product_name),
                'sku' => $v->sku ?? null,
                'store_id' => $r['store_id'],
                'store' => $stores[$r['store_id']] ?? 'Unknown store',
                'on_hand' => $r['on_hand'],
                'reorder_point' => $r['reorder_point'],
                'shortfall' => $r['shortfall'],
            ];
        }, $rows);
    }

    /**
     * The 10 latest POS sales and (with `web_orders.view`) web orders, newest first.
     *
     * @return list<array<string, mixed>>
     */
    private function recent(ReportContext $context, bool $canViewWeb): array
    {
        $sales = DB::table('sales as s')->leftJoin('customers as c', 'c.id', '=', 's.customer_id')
            ->where('s.organization_id', $context->organizationId)
            ->tap(fn (Builder $q) => $context->scopeBranches($q, 's.branch_id'))
            ->orderByDesc('s.sold_at')->orderByDesc('s.id')->limit(10)
            ->get(['s.id', 's.number', 's.sold_at as at', 's.total', 's.status', 'c.name as customer', 's.branch_id'])
            ->map(fn ($s) => [
                'type' => 'sale',
                'channel' => 'pos',
                'id' => $s->id,
                'number' => $s->number,
                'date' => CarbonImmutable::parse((string) $s->at, 'UTC')->setTimezone($context->timezone)->toIso8601String(),
                'customer' => $s->customer ?? 'Walk-in',
                'total' => Sql::money($s->total),
                'status' => $s->status,
                'branch_id' => $s->branch_id,
                'link' => '/sales/'.$s->id,
            ]);
        $orders = ! $canViewWeb ? collect() : DB::table('orders as o')
            ->where('o.organization_id', $context->organizationId)
            ->tap(fn (Builder $q) => $context->scopeBranches($q, 'o.branch_id'))
            ->orderByDesc('o.placed_at')->orderByDesc('o.id')->limit(10)
            ->get(['o.id', 'o.number', 'o.placed_at as at', 'o.total', 'o.status', 'o.contact_name as customer', 'o.branch_id'])
            ->map(fn ($o) => [
                'type' => 'web_order',
                'channel' => 'online',
                'id' => $o->id,
                'number' => $o->number,
                'date' => CarbonImmutable::parse((string) $o->at, 'UTC')->setTimezone($context->timezone)->toIso8601String(),
                'customer' => $o->customer,
                'total' => Sql::money($o->total),
                'status' => $o->status,
                'branch_id' => $o->branch_id,
                'link' => '/web-orders/'.$o->id,
            ]);

        return $sales->concat($orders)
            ->sortByDesc(fn (array $t) => CarbonImmutable::parse($t['date'])->getTimestamp())
            ->take(10)->values()->all();
    }

    /**
     * Net sales per branch when the user's scope covers more than one branch; null otherwise.
     *
     * @return list<array<string, mixed>>|null
     */
    private function byBranch(ReportContext $context): ?array
    {
        $branches = $context->branchIds ?? DB::table('branches')->where('organization_id', $context->organizationId)->pluck('id')->all();
        if (count($branches) < 2) {
            return null;
        }
        $rows = $this->facts->aggregate($context, ['branch']);
        $names = Names::of('branch', $context->organizationId, $branches);
        $byBranch = array_column($rows, null, 'branch');

        $result = [];
        foreach ($branches as $id) {
            $result[] = [
                'branch_id' => $id,
                'name' => $names[$id] ?? 'Unknown branch',
                'net_sales' => $byBranch[$id]['net_sales'] ?? '0.00',
                'orders' => $byBranch[$id]['orders'] ?? 0,
            ];
        }
        usort($result, fn (array $a, array $b) => Decimal::compare($b['net_sales'], $a['net_sales']) ?: strcmp($a['name'], $b['name']));

        return $result;
    }
}
