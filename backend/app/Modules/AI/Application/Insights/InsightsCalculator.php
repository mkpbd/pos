<?php

namespace App\Modules\AI\Application\Insights;

use App\Modules\AI\Application\Support\Figures;
use App\Modules\AI\Domain\Insights\SalesAnomalies;
use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Purchasing\Application\Queries\ReorderSuggestions;
use App\Modules\Reports\Application\ReportRegistry;
use App\Modules\Reports\Application\ReportRunner;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Auth\Access\Authorizable;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

/**
 * Deterministic business insights (PHP/SQL; the model only narrates them). Every figure comes
 * from the Phase 7 report registry run through ReportRunner in the reader's scope (tenant,
 * branches, cost visibility) or from SC1's reorder suggestions:
 *
 * - KPIs (sales_daily totals) of the period vs the previous period: net sales, orders, average
 *   ticket, returns, gross sales, and with cost gross profit and margin. Daily = one day vs the
 *   day before; monthly = the month up to the date (at most today) vs the same number of days
 *   from the start of the previous month (capped at its end).
 * - top movers (sales_by_product): the 5 products whose net sales rose / fell most vs the
 *   previous period.
 * - anomalies (sales_daily over the period plus 28 days before): SalesAnomalies — |z| ≥ 2.5
 *   against the trailing 28-day mean / sample standard deviation, at least 14 days of history.
 * - margin drop (with cost): flagged when the margin fell by ≥ 5 percentage points.
 * - return spike: return rate = returns ÷ gross sales × 100; flagged when ≥ 5 % and at least
 *   double the previous rate (or the previous period had no returns).
 * - slow movers: products in stock now (inventory_valuation by product) with no net units sold
 *   in the 30 days up to the period end (sales_by_product); ordered by stock value (cost) or
 *   quantity.
 * - shortage risk (purchases.view): SC1 suggestions of every active store in scope whose days of
 *   cover are below the supplier lead time.
 */
final class InsightsCalculator
{
    public const TOP_MOVERS = 5;

    public const LIST_LIMIT = 10;

    public const SLOW_MOVER_DAYS = 30;

    public const MARGIN_DROP_POINTS = '5';

    public const RETURN_SPIKE_MIN_RATE = '5';

    public function __construct(
        private readonly ReportRegistry $registry,
        private readonly ReportRunner $runner,
        private readonly ReorderSuggestions $suggestions,
        private readonly BranchDirectory $branches,
    ) {}

    /**
     * The facts of one period for the reader's scope (∩ branch).
     *
     * @return array<string, mixed>
     */
    public function facts(TenantUser&Authorizable $reader, string $period, string $date, ?string $branchId, string $today): array
    {
        [$from, $to, $prevFrom, $prevTo] = self::periods($period, $date, $today);
        $branch = $branchId === null ? [] : ['branch_id' => $branchId];
        $canViewCost = $reader->can('products.view_cost');

        $current = $this->run('sales_daily', ['date_from' => $from, 'date_to' => $to] + $branch, $reader);
        $previous = $this->run('sales_daily', ['date_from' => $prevFrom, 'date_to' => $prevTo] + $branch, $reader);
        $now = (array) $current['totals'];
        $before = (array) $previous['totals'];

        $kpis = [
            'net_sales' => Figures::compare($now['net_sales'] ?? '0', $before['net_sales'] ?? '0'),
            'orders' => Figures::compare((int) ($now['orders'] ?? 0), (int) ($before['orders'] ?? 0)),
            'average_ticket' => Figures::compare($now['average_ticket'] ?? '0', $before['average_ticket'] ?? '0'),
            'gross_sales' => Figures::compare($now['gross_sales'] ?? '0', $before['gross_sales'] ?? '0'),
            'returns' => Figures::compare($now['returns'] ?? '0', $before['returns'] ?? '0'),
        ];
        $marginDrop = null;
        if ($canViewCost) {
            $kpis['gross_profit'] = Figures::compare($now['gross_profit'] ?? '0', $before['gross_profit'] ?? '0');
            $kpis['margin'] = ['value' => $now['margin'] ?? null, 'previous' => $before['margin'] ?? null];
            $marginDrop = self::marginDrop($now['margin'] ?? null, $before['margin'] ?? null);
        }

        $shortage = $reader->can('purchases.view') ? $this->shortageRisk($reader, $branchId, null) : null;

        return [
            'period' => $period,
            'date_from' => $from,
            'date_to' => $to,
            'previous_from' => $prevFrom,
            'previous_to' => $prevTo,
            'branch_id' => $branchId,
            'timezone' => $current['params']['timezone'] ?? null,
            'currency' => $current['params']['currency'] ?? null,
            'kpis' => $kpis,
            'top_movers' => $this->topMovers($reader, $from, $to, $prevFrom, $prevTo, $branch),
            'anomalies' => $this->anomalies($reader, $branchId, $from, $to),
            'margin_drop' => $marginDrop,
            'return_spike' => self::returnSpike($now, $before),
            'slow_movers' => $this->slowMovers($reader, $branchId, $to),
            'shortage_risk' => $shortage,
            'omitted' => $canViewCost ? [] : ['gross_profit', 'margin', 'margin_drop', 'stock_value'],
        ];
    }

    /**
     * [from, to, previous from, previous to] (Y-m-d, organization-local).
     *
     * @return array{0: string, 1: string, 2: string, 3: string}
     */
    public static function periods(string $period, string $date, string $today): array
    {
        $day = CarbonImmutable::createFromFormat('!Y-m-d', $date);
        if ($period === 'daily') {
            return [$day->toDateString(), $day->toDateString(), $day->subDay()->toDateString(), $day->subDay()->toDateString()];
        }
        if ($period !== 'monthly') {
            throw new InvalidArgumentException("Unknown period [{$period}].");
        }
        $from = $day->startOfMonth();
        $to = $day->endOfMonth()->startOfDay();
        $todayDate = CarbonImmutable::createFromFormat('!Y-m-d', $today);
        if ($to->greaterThan($todayDate)) {
            $to = $todayDate;
        }
        $prevFrom = $from->subMonthNoOverflow();
        $prevTo = $prevFrom->addDays((int) $from->diffInDays($to));
        $prevEnd = $prevFrom->endOfMonth()->startOfDay();
        if ($prevTo->greaterThan($prevEnd)) {
            $prevTo = $prevEnd;
        }

        return [$from->toDateString(), $to->toDateString(), $prevFrom->toDateString(), $prevTo->toDateString()];
    }

    /**
     * Unusual days in [from, to] (at most 92 days).
     *
     * @return list<array<string, mixed>>
     */
    public function anomalies(TenantUser&Authorizable $reader, ?string $branchId, string $from, string $to): array
    {
        $start = CarbonImmutable::createFromFormat('!Y-m-d', $from);
        $end = CarbonImmutable::createFromFormat('!Y-m-d', $to);
        if ($end->lessThan($start) || $start->diffInDays($end) > 91) {
            throw ValidationException::withMessages(['date_to' => ['Check at most 92 days for unusual sales.']]);
        }
        $input = ['date_from' => $start->subDays(SalesAnomalies::WINDOW_DAYS)->toDateString(), 'date_to' => $to];
        if ($branchId !== null) {
            $input['branch_id'] = $branchId;
        }
        $series = [];
        foreach ($this->run('sales_daily', $input, $reader)['rows'] as $row) {
            $series[$row['date']] = (string) $row['net_sales'];
        }
        $dates = [];
        for ($d = $start; $d <= $end; $d = $d->addDay()) {
            $dates[] = $d->toDateString();
        }

        return SalesAnomalies::detect($series, $dates);
    }

    /**
     * Products in stock now with no net sales in the $days days up to $endDate.
     *
     * @return array{days: int, count: int, items: list<array<string, mixed>>}
     */
    public function slowMovers(TenantUser&Authorizable $reader, ?string $branchId, string $endDate, int $days = self::SLOW_MOVER_DAYS, int $limit = self::LIST_LIMIT): array
    {
        $branch = $branchId === null ? [] : ['branch_id' => $branchId];
        $stock = $this->run('inventory_valuation', ['group_by' => 'product'] + $branch, $reader)['rows'];
        $from = CarbonImmutable::createFromFormat('!Y-m-d', $endDate)->subDays($days - 1)->toDateString();
        $sold = [];
        foreach ($this->run('sales_by_product', ['date_from' => $from, 'date_to' => $endDate] + $branch, $reader)['rows'] as $row) {
            if (Decimal::compare(Figures::plain($row['quantity'] ?? '0'), '0') > 0) {
                $sold[$row['product_id']] = true;
            }
        }

        $items = [];
        foreach ($stock as $row) {
            if ($row['group_id'] === null || isset($sold[$row['group_id']]) || Decimal::compare(Figures::plain($row['quantity']), '0') <= 0) {
                continue;
            }
            $item = ['product_id' => $row['group_id'], 'product' => $row['group'], 'on_hand' => $row['quantity'], 'variants_in_stock' => $row['items']];
            if (array_key_exists('value', $row)) {
                $item['stock_value'] = $row['value'];
            }
            $items[] = $item;
        }
        $key = $reader->can('products.view_cost') ? 'stock_value' : 'on_hand';
        usort($items, fn (array $a, array $b) => Decimal::compare(Figures::plain($b[$key] ?? '0'), Figures::plain($a[$key] ?? '0')) ?: strcmp($a['product'], $b['product']));

        return ['days' => $days, 'count' => count($items), 'items' => array_slice($items, 0, $limit)];
    }

    /**
     * SC1 suggestions whose days of cover are below the supplier lead time, across the active
     * stores in scope (optionally one store).
     *
     * @return array{count: int, stores_checked: int, items: list<array<string, mixed>>}
     */
    public function shortageRisk(TenantUser&Authorizable $reader, ?string $branchId, ?string $storeId, int $limit = self::LIST_LIMIT): array
    {
        // Validates the branch / store against the organization and the reader's branches.
        $report = $this->registry->find('low_stock') ?? throw new InvalidArgumentException('low_stock report missing.');
        $context = $this->runner->context($report, array_filter(['branch_id' => $branchId, 'store_id' => $storeId]), $reader);

        $stores = array_values(array_filter(
            $this->branches->activeStores($context->organizationId),
            fn (array $s) => ($context->branchIds === null || in_array($s['branch_id'], $context->branchIds, true))
                && ($storeId === null || $s['id'] === $storeId),
        ));

        $items = [];
        foreach ($stores as $store) {
            foreach ($this->suggestions->forStore($context->organizationId, $store['id'])['rows'] as $row) {
                $cover = $row['days_of_cover'];
                if ($cover === null || Decimal::compare((string) $cover, (string) $row['lead_time_days']) >= 0) {
                    continue;
                }
                $items[] = [
                    'store_id' => $store['id'],
                    'store' => $store['name'],
                    'product' => $row['variant']['product_name'].($row['variant']['variant_name'] ? ' — '.$row['variant']['variant_name'] : ''),
                    'sku' => $row['variant']['sku'],
                    'on_hand' => $row['on_hand'],
                    'avg_daily' => $row['avg_daily'],
                    'days_of_cover' => (string) $cover,
                    'lead_time_days' => (int) $row['lead_time_days'],
                    'suggested_purchase' => $row['suggested_purchase'],
                    'suggested_transfer' => $row['suggested_transfer'],
                    'supplier' => $row['supplier']['name'] ?? null,
                ];
            }
        }
        usort($items, fn (array $a, array $b) => Decimal::compare($a['days_of_cover'], $b['days_of_cover']) ?: strcmp($a['product'], $b['product']));

        return ['count' => count($items), 'stores_checked' => count($stores), 'items' => array_slice($items, 0, $limit)];
    }

    /**
     * @param  array<string, string>  $branch
     * @return array{up: list<array<string, mixed>>, down: list<array<string, mixed>>}
     */
    private function topMovers(TenantUser&Authorizable $reader, string $from, string $to, string $prevFrom, string $prevTo, array $branch): array
    {
        $now = $this->run('sales_by_product', ['date_from' => $from, 'date_to' => $to] + $branch, $reader)['rows'];
        $before = $this->run('sales_by_product', ['date_from' => $prevFrom, 'date_to' => $prevTo] + $branch, $reader)['rows'];

        $products = [];
        foreach ($before as $row) {
            $products[$row['product_id']] = ['product_id' => $row['product_id'], 'product' => $row['product'], 'net_sales' => '0.00', 'previous' => Figures::plain($row['net_sales'])];
        }
        foreach ($now as $row) {
            $products[$row['product_id']] = ['product_id' => $row['product_id'], 'product' => $row['product'], 'net_sales' => Figures::plain($row['net_sales']),
                'previous' => $products[$row['product_id']]['previous'] ?? '0.00'];
        }
        $movers = [];
        foreach ($products as $p) {
            $p['change'] = Decimal::sub($p['net_sales'], $p['previous'], 2);
            $p['net_sales'] = Decimal::round($p['net_sales'], 2);
            $p['previous'] = Decimal::round($p['previous'], 2);
            $movers[] = $p;
        }
        $up = array_values(array_filter($movers, fn (array $p) => Decimal::compare($p['change'], '0') > 0));
        $down = array_values(array_filter($movers, fn (array $p) => Decimal::compare($p['change'], '0') < 0));
        usort($up, fn (array $a, array $b) => Decimal::compare($b['change'], $a['change']) ?: strcmp($a['product'], $b['product']));
        usort($down, fn (array $a, array $b) => Decimal::compare($a['change'], $b['change']) ?: strcmp($a['product'], $b['product']));

        return ['up' => array_slice($up, 0, self::TOP_MOVERS), 'down' => array_slice($down, 0, self::TOP_MOVERS)];
    }

    /**
     * @return array{current: ?string, previous: ?string, change_points: ?string, flagged: bool}
     */
    public static function marginDrop(?string $current, ?string $previous): array
    {
        if ($current === null || $previous === null) {
            return ['current' => $current, 'previous' => $previous, 'change_points' => null, 'flagged' => false];
        }
        $change = Decimal::sub($current, $previous, 2);

        return [
            'current' => $current,
            'previous' => $previous,
            'change_points' => $change,
            'flagged' => Decimal::compare($change, '-'.self::MARGIN_DROP_POINTS) <= 0,
        ];
    }

    /**
     * @param  array<string, mixed>  $now
     * @param  array<string, mixed>  $before
     * @return array{rate: ?string, previous_rate: ?string, returns: string, flagged: bool}
     */
    public static function returnSpike(array $now, array $before): array
    {
        $rate = Figures::percent(Figures::plain($now['returns'] ?? '0'), Figures::plain($now['gross_sales'] ?? '0'));
        $previous = Figures::percent(Figures::plain($before['returns'] ?? '0'), Figures::plain($before['gross_sales'] ?? '0'));
        $flagged = $rate !== null
            && Decimal::compare($rate, self::RETURN_SPIKE_MIN_RATE) >= 0
            && ($previous === null || Decimal::isZero($previous) || Decimal::compare($rate, Decimal::mul($previous, '2', 2)) >= 0);

        return ['rate' => $rate, 'previous_rate' => $previous, 'returns' => Decimal::round(Figures::plain($now['returns'] ?? '0'), 2), 'flagged' => $flagged];
    }

    /**
     * Every row of a registry report for the reader (cost-sensitive keys removed without
     * products.view_cost), with totals and the resolved parameters.
     *
     * @param  array<string, mixed>  $input
     * @return array{rows: list<array<string, mixed>>, totals: ?array<string, mixed>, params: array<string, mixed>}
     */
    public function run(string $key, array $input, TenantUser&Authorizable $reader): array
    {
        $report = $this->registry->find($key) ?? throw new InvalidArgumentException("Unknown report [{$key}].");
        $definition = $report->definition();
        $context = $this->runner->context($report, $input, $reader);
        $result = $report->run($context);
        $hidden = $context->canViewCost ? [] : $definition->costSensitiveKeys();
        $rows = $result->isQuery()
            ? ($result->present)(collect($this->runner->orderedQuery($result, null, false)->limit(ReportRunner::MAX_PER_PAGE)->get()->all()))
            : ($result->rows ?? []);

        return [
            'rows' => array_map(fn (array $row) => ReportRunner::strip($row, $hidden), $rows),
            'totals' => $result->totals === null ? null : ReportRunner::strip($result->totals, $hidden),
            'params' => $this->runner->presentParams($context),
        ];
    }
}
