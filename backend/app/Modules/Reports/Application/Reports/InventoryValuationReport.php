<?php

namespace App\Modules\Reports\Application\Reports;

use App\Modules\Reports\Application\Contracts\Report;
use App\Modules\Reports\Application\ReportContext;
use App\Modules\Reports\Application\ReportResult;
use App\Modules\Reports\Application\Support\Names;
use App\Modules\Reports\Application\Support\Sql;
use App\Modules\Reports\Domain\ReportColumn;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Domain\ReportGroup;
use App\Modules\Reports\Domain\ReportParam;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Inventory valuation as of now: positive stock on hand (all batches) per store, category or
 * product, valued at each level's weighted average cost (landed costs included):
 *   value = Σ quantity × average_cost; share = value ÷ total value × 100.
 * Value and share are cost-sensitive.
 */
class InventoryValuationReport implements Report
{
    private const GROUPS = ['store' => 'Store', 'category' => 'Category', 'product' => 'Product'];

    public function definition(): ReportDefinition
    {
        return new ReportDefinition(
            key: 'inventory_valuation',
            title: 'Inventory valuation',
            description: 'Quantity and value (weighted average cost) of the stock on hand now, per store, category or product.',
            group: ReportGroup::Inventory,
            permission: 'reports.view',
            params: [
                ReportParam::branch(), ReportParam::store(), ReportParam::category(), ReportParam::brand(),
                ReportParam::groupBy(self::GROUPS, 'store'),
            ],
            columns: [
                ReportColumn::text('group', 'Group'),
                ReportColumn::number('items', 'Items in stock'),
                ReportColumn::quantity('quantity', 'Quantity'),
                ReportColumn::money('value', 'Value', costSensitive: true),
                ReportColumn::percent('share', 'Share of value %', costSensitive: true),
            ],
            defaultSort: '-value',
        );
    }

    public function run(ReportContext $context): ReportResult
    {
        $groupBy = (string) $context->param('group_by', 'store');
        $expression = match ($groupBy) {
            'category' => 'p.category_id',
            'product' => 'pv.product_id',
            default => 'sl.store_id',
        };

        $rows = $this->base($context)
            ->groupByRaw($expression)
            ->selectRaw($expression.' as group_id, COUNT(DISTINCT sl.variant_id) as items, SUM(sl.quantity) as quantity, SUM(sl.quantity * sl.average_cost) as value')
            ->get();
        $total = $this->base($context)
            ->selectRaw('COUNT(DISTINCT sl.variant_id) as items, SUM(sl.quantity) as quantity, SUM(sl.quantity * sl.average_cost) as value')
            ->first();
        $totalValue = Sql::money($total?->value);

        $names = Names::of($groupBy === 'category' ? 'category' : ($groupBy === 'product' ? 'product' : 'store'), $context->organizationId, $rows->pluck('group_id'));
        $result = $rows->map(fn ($row) => [
            'group_id' => $row->group_id,
            'group' => $row->group_id === null ? ($groupBy === 'category' ? 'Uncategorized' : 'Unknown') : ($names[$row->group_id] ?? 'Unknown'),
            'items' => (int) $row->items,
            'quantity' => Sql::quantity($row->quantity),
            'value' => Sql::money($row->value),
            'share' => Sql::percent(Sql::money($row->value), $totalValue),
        ])->all();

        return ReportResult::rows($result, [
            'items' => (int) ($total->items ?? 0),
            'quantity' => Sql::quantity($total?->quantity),
            'value' => $totalValue,
            'share' => Sql::percent($totalValue, $totalValue),
        ], ['group' => self::GROUPS[$groupBy] ?? 'Store'], ['as_of' => $context->now->setTimezone($context->timezone)->toIso8601String()]);
    }

    private function base(ReportContext $context): Builder
    {
        $query = DB::table('stock_levels as sl')
            ->join('product_variants as pv', 'pv.id', '=', 'sl.variant_id')
            ->join('products as p', 'p.id', '=', 'pv.product_id')
            ->where('sl.organization_id', $context->organizationId)
            ->where('sl.quantity', '>', 0);
        $context->scopeBranches($query, 'sl.branch_id');

        return $query->when($context->param('store_id'), fn (Builder $q, string $id) => $q->where('sl.store_id', $id))
            ->when($context->categoryIds, fn (Builder $q, array $ids) => $q->whereIn('p.category_id', $ids))
            ->when($context->param('brand_id'), fn (Builder $q, string $id) => $q->where('p.brand_id', $id));
    }
}
