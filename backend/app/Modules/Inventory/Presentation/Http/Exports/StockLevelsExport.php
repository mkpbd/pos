<?php

namespace App\Modules\Inventory\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * GET /inventory/stock?export=xlsx|pdf — stock on hand per store and variant; value only
 * with `products.view_cost`.
 */
class StockLevelsExport extends InventoryListExport
{
    public function name(): string
    {
        return 'stock';
    }

    public function title(): string
    {
        return 'Stock on hand';
    }

    public function columns(): array
    {
        return array_values(array_filter([
            ...self::productColumns(),
            ExportColumn::text('store.name', 'Store'),
            ExportColumn::text('store.branch_name', 'Branch'),
            ExportColumn::quantity('quantity', 'On hand'),
            ExportColumn::text('variant.unit_code', 'Unit'),
            ExportColumn::quantity('reorder_level', 'Reorder level'),
            ExportColumn::text('is_low', 'Low stock', fn (array $r) => ($r['is_low'] ?? false) ? 'Yes' : null),
            Gate::allows('products.view_cost') ? ExportColumn::money('value', 'Value') : null,
        ]));
    }

    public function filters(Request $request): array
    {
        return $this->summary($request)->flag('low_stock', 'Low stock only')->all();
    }
}
