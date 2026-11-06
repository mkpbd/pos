<?php

namespace App\Modules\Reports\Application\Reports;

use App\Modules\Purchasing\Application\Queries\ReorderSuggestions;
use App\Modules\Reports\Application\Contracts\Report;
use App\Modules\Reports\Application\ReportContext;
use App\Modules\Reports\Application\ReportResult;
use App\Modules\Reports\Application\Support\LowStock;
use App\Modules\Reports\Application\Support\Names;
use App\Modules\Reports\Domain\ReportColumn;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Domain\ReportGroup;
use App\Modules\Reports\Domain\ReportParam;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Facades\DB;

/**
 * Low stock now (LowStock: on hand ≤ reorder point from the SC1 rule or the variant's reorder
 * level), with the SC1 reorder calculator's suggestion for each row — the quantity to buy and
 * the quantity a source store can transfer (Purchasing `ReorderSuggestions`, which accounts
 * for open orders, transfers in transit, sales velocity and pack sizes; 0 when the calculator
 * sees nothing to order, e.g. enough already on order) and the preferred supplier.
 */
class LowStockReport implements Report
{
    public function __construct(
        private readonly LowStock $lowStock,
        private readonly ReorderSuggestions $suggestions,
    ) {}

    public function definition(): ReportDefinition
    {
        return new ReportDefinition(
            key: 'low_stock',
            title: 'Low stock',
            description: 'Items at or below their reorder point in each store, with the suggested purchase or transfer quantity.',
            group: ReportGroup::Inventory,
            permission: 'reports.view',
            params: [
                ReportParam::branch(), ReportParam::store(), ReportParam::product(), ReportParam::category(),
                ReportParam::brand(), ReportParam::supplier(),
            ],
            columns: [
                ReportColumn::text('product', 'Product'),
                ReportColumn::text('sku', 'SKU'),
                ReportColumn::text('store', 'Store'),
                ReportColumn::quantity('on_hand', 'On hand'),
                ReportColumn::quantity('reorder_point', 'Reorder point'),
                ReportColumn::quantity('shortfall', 'Shortfall'),
                ReportColumn::quantity('suggested_purchase', 'Suggested purchase'),
                ReportColumn::quantity('suggested_transfer', 'Suggested transfer'),
                ReportColumn::text('supplier', 'Preferred supplier'),
            ],
            defaultSort: '-shortfall',
        );
    }

    public function run(ReportContext $context): ReportResult
    {
        $low = $this->lowStock->rows($context);
        $variants = DB::table('product_variants as pv')->join('products as p', 'p.id', '=', 'pv.product_id')
            ->where('pv.organization_id', $context->organizationId)
            ->whereIn('pv.id', array_values(array_unique(array_column($low, 'variant_id'))))
            ->get(['pv.id', 'pv.sku', 'pv.name as variant_name', 'p.id as product_id', 'p.name as product_name'])->keyBy('id');
        $stores = Names::of('store', $context->organizationId, array_column($low, 'store_id'));

        $suggestions = [];
        foreach (array_unique(array_column($low, 'store_id')) as $storeId) {
            foreach ($this->suggestions->forStore($context->organizationId, $storeId)['rows'] as $s) {
                $suggestions[$storeId][$s['variant']['id']] = $s;
            }
        }

        $rows = [];
        $purchase = '0.000';
        $transfer = '0.000';
        foreach ($low as $row) {
            $v = $variants[$row['variant_id']] ?? null;
            $s = $suggestions[$row['store_id']][$row['variant_id']] ?? null;
            $rows[] = [
                'product_id' => $v->product_id ?? null,
                'variant_id' => $row['variant_id'],
                'product' => $v === null ? 'Unknown product' : ($v->variant_name !== null && $v->variant_name !== '' ? $v->product_name.' — '.$v->variant_name : $v->product_name),
                'sku' => $v->sku ?? null,
                'store_id' => $row['store_id'],
                'store' => $stores[$row['store_id']] ?? 'Unknown store',
                'on_hand' => $row['on_hand'],
                'reorder_point' => $row['reorder_point'],
                'shortfall' => $row['shortfall'],
                'suggested_purchase' => $s['suggested_purchase'] ?? '0.000',
                'suggested_transfer' => $s['suggested_transfer'] ?? '0.000',
                'supplier_id' => $s['supplier']['id'] ?? null,
                'supplier' => $s['supplier']['name'] ?? null,
                'has_rule' => $row['has_rule'],
            ];
            $purchase = Decimal::add($purchase, $s['suggested_purchase'] ?? '0', 3);
            $transfer = Decimal::add($transfer, $s['suggested_transfer'] ?? '0', 3);
        }

        return ReportResult::rows($rows, [
            'items' => count($rows),
            'suggested_purchase' => $purchase,
            'suggested_transfer' => $transfer,
        ]);
    }
}
