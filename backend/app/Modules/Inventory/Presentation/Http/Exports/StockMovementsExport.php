<?php

namespace App\Modules\Inventory\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * GET /inventory/movements?export=xlsx|pdf — the stock ledger; unit cost only with
 * `products.view_cost`.
 */
class StockMovementsExport extends InventoryListExport
{
    public function name(): string
    {
        return 'stock-movements';
    }

    public function title(): string
    {
        return 'Stock movements';
    }

    public function columns(): array
    {
        return array_values(array_filter([
            ExportColumn::dateTime('created_at', 'Date'),
            ExportColumn::status('type', 'Type'),
            ...self::productColumns(),
            ExportColumn::text('batch.batch_number', 'Batch'),
            ExportColumn::text('store.name', 'Store'),
            ExportColumn::quantity('quantity', 'Quantity'),
            ExportColumn::quantity('balance_after', 'Balance'),
            Gate::allows('products.view_cost') ? ExportColumn::money('unit_cost', 'Unit cost') : null,
            ExportColumn::text('reference.number', 'Reference'),
            ExportColumn::text('created_by', 'By', fn (array $r) => $this->userName($r['created_by'] ?? null)),
        ]));
    }

    public function filters(Request $request): array
    {
        return $this->summary($request)->value('type', 'Type')->dates()->all();
    }
}
