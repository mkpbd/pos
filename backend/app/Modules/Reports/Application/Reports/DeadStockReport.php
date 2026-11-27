<?php

namespace App\Modules\Reports\Application\Reports;

use App\Modules\Reports\Application\Contracts\Report;
use App\Modules\Reports\Application\ReportContext;
use App\Modules\Reports\Application\ReportResult;
use App\Modules\Reports\Application\Support\Sql;
use App\Modules\Reports\Domain\ReportColumn;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Domain\ReportGroup;
use App\Modules\Reports\Domain\ReportParam;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * R1 dead stock / stock aging, as of now: variants with stock on hand (positive levels in the
 * stores in scope) that have not sold in the last `days` days (today and the `days − 1` days
 * before, organization-local) — neither on a completed till sale nor on a web order that was
 * not cancelled or failed (by `placed_at`), in the stores in scope.
 *   value             Σ quantity × weighted average cost (cost-sensitive)
 *   last_sold_on      the last such sale's local day (null = never sold in these stores)
 *   last_received_on  the last stock received (opening stock, purchase receipt, transfer in or
 *                     adjustment in); null = none recorded
 * `meta.aging`: the listed stock per days since it was last received (0–30, 31–60, 61–90,
 * 91–180, over 180; never received counts as over 180) — items, quantity and value (value only
 * with `products.view_cost`).
 */
class DeadStockReport implements Report
{
    private const RECEIVED = ['opening', 'purchase_receipt', 'transfer_in', 'adjustment_in'];

    private const BUCKETS = ['days_0_30' => '0–30 days', 'days_31_60' => '31–60 days', 'days_61_90' => '61–90 days', 'days_91_180' => '91–180 days', 'days_over_180' => 'Over 180 days'];

    public function definition(): ReportDefinition
    {
        return new ReportDefinition(
            key: 'dead_stock',
            title: 'Dead stock',
            description: 'Items in stock that have not sold in the last N days, with their value, last sale and last receipt, and the stock aged by last receipt.',
            group: ReportGroup::Inventory,
            permission: 'reports.view',
            params: [
                ReportParam::branch(), ReportParam::store(), ReportParam::category(),
                ReportParam::integer('days', 'Not sold for (days)', 1, 3650, 90),
            ],
            columns: [
                ReportColumn::text('product', 'Product'),
                ReportColumn::text('sku', 'SKU'),
                ReportColumn::quantity('on_hand', 'On hand'),
                ReportColumn::money('value', 'Value', costSensitive: true),
                ReportColumn::date('last_sold_on', 'Last sold'),
                ReportColumn::number('days_since_sold', 'Days since sold'),
                ReportColumn::date('last_received_on', 'Last received'),
            ],
            defaultSort: '-value',
        );
    }

    public function run(ReportContext $context): ReportResult
    {
        $today = CarbonImmutable::parse($context->today());
        $cutoff = $context->fromInstant($today->subDays((int) $context->param('days', 90) - 1)->toDateString());

        $stock = DB::table('stock_levels as sl')
            ->join('product_variants as pv', 'pv.id', '=', 'sl.variant_id')
            ->join('products as p', 'p.id', '=', 'pv.product_id')
            ->where('sl.organization_id', $context->organizationId)
            ->where('sl.quantity', '>', 0);
        $this->scope($stock, $context, 'sl');
        $stock = $stock->when($context->categoryIds, fn (Builder $q, array $ids) => $q->whereIn('p.category_id', $ids))
            ->groupBy('sl.variant_id', 'pv.product_id', 'p.name', 'pv.name', 'pv.sku')
            ->selectRaw('sl.variant_id, pv.product_id, p.name as product_name, pv.name as variant_name, pv.sku, SUM(sl.quantity) as on_hand, SUM(sl.quantity * sl.average_cost) as value')
            ->get();

        $tillSales = DB::table('sale_lines as l')->join('sales as s', 's.id', '=', 'l.sale_id')
            ->where('s.organization_id', $context->organizationId)->where('s.status', 'completed');
        $this->scope($tillSales, $context, 's');
        $webSales = DB::table('order_lines as l')->join('orders as o', 'o.id', '=', 'l.order_id')
            ->where('o.organization_id', $context->organizationId)->whereNotIn('o.status', ['cancelled', 'failed']);
        $this->scope($webSales, $context, 'o');
        $received = DB::table('stock_movements as m')
            ->where('m.organization_id', $context->organizationId)->whereIn('m.type', self::RECEIVED)->where('m.quantity', '>', 0);
        $this->scope($received, $context, 'm');

        $lastSold = $this->latest($tillSales->groupBy('l.variant_id')->selectRaw('l.variant_id, MAX(s.sold_at) as at'));
        foreach ($this->latest($webSales->groupBy('l.variant_id')->selectRaw('l.variant_id, MAX(o.placed_at) as at')) as $variant => $at) {
            $lastSold[$variant] = max($lastSold[$variant] ?? '', $at);
        }
        $lastReceived = $this->latest($received->groupBy('m.variant_id')->selectRaw('m.variant_id, MAX(m.created_at) as at'));

        $local = fn (?string $at) => $at === null ? null : CarbonImmutable::parse($at)->setTimezone($context->timezone)->toDateString();
        $daysSince = fn (?string $day) => $day === null ? null : (int) CarbonImmutable::parse($day)->diffInDays($today);
        $cutoffAt = CarbonImmutable::parse($cutoff)->utc()->toIso8601String();

        $rows = [];
        $totals = ['on_hand' => '0.000', 'value' => '0.00'];
        $aging = array_map(fn (string $label) => ['label' => $label, 'items' => 0, 'quantity' => '0.000', 'value' => '0.00'], self::BUCKETS);
        foreach ($stock as $s) {
            $sold = $lastSold[$s->variant_id] ?? null;
            if ($sold !== null && $sold >= $cutoffAt) {
                continue;
            }
            $receivedOn = $local($lastReceived[$s->variant_id] ?? null);
            $row = [
                'variant_id' => $s->variant_id,
                'product_id' => $s->product_id,
                'product' => $s->variant_name !== null && $s->variant_name !== '' ? $s->product_name.' — '.$s->variant_name : $s->product_name,
                'sku' => $s->sku,
                'on_hand' => Sql::quantity($s->on_hand),
                'value' => Sql::money($s->value),
                'last_sold_on' => $local($sold),
                'days_since_sold' => $daysSince($local($sold)),
                'last_received_on' => $receivedOn,
            ];
            $rows[] = $row;
            $totals['on_hand'] = Decimal::add($totals['on_hand'], $row['on_hand'], 3);
            $totals['value'] = Decimal::add($totals['value'], $row['value'], 2);
            $bucket = self::bucket($daysSince($receivedOn));
            $aging[$bucket]['items']++;
            $aging[$bucket]['quantity'] = Decimal::add($aging[$bucket]['quantity'], $row['on_hand'], 3);
            $aging[$bucket]['value'] = Decimal::add($aging[$bucket]['value'], $row['value'], 2);
        }

        $aging = array_map(fn (string $key, array $b) => ['key' => $key] + ($context->canViewCost ? $b : array_diff_key($b, ['value' => true])), array_keys($aging), $aging);

        return ReportResult::rows($rows, $totals + ['items' => count($rows)], meta: [
            'as_of' => $context->now->setTimezone($context->timezone)->toIso8601String(),
            'aging' => $aging,
        ]);
    }

    private static function bucket(?int $days): string
    {
        return match (true) {
            $days === null, $days > 180 => 'days_over_180',
            $days <= 30 => 'days_0_30',
            $days <= 60 => 'days_31_60',
            $days <= 90 => 'days_61_90',
            default => 'days_91_180',
        };
    }

    /**
     * variant id => latest instant (UTC ISO 8601), from a query selecting `variant_id` and `at`.
     *
     * @return array<string, string>
     */
    private function latest(Builder $query): array
    {
        return $query->get()->mapWithKeys(fn ($r) => [(string) $r->variant_id => CarbonImmutable::parse((string) $r->at)->utc()->toIso8601String()])->all();
    }

    private function scope(Builder $query, ReportContext $context, string $alias): void
    {
        $context->scopeBranches($query, $alias.'.branch_id');
        $query->when($context->param('store_id'), fn (Builder $q, string $id) => $q->where($alias.'.store_id', $id));
    }
}
