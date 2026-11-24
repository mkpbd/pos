<?php

namespace App\Modules\Inventory\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use Illuminate\Http\Request;

/**
 * GET /inventory/stocktakes/{id}/lines?export=xlsx|csv|pdf (ST1) — the count sheet or, with
 * `filter=variance`, the variance list. Hidden figures (blind stocktake, no cost permission)
 * stay empty, as on screen.
 */
class StocktakeLinesExport extends InventoryListExport
{
    private string $number = '';

    public function forStocktake(string $number): static
    {
        $this->number = $number;

        return $this;
    }

    public function name(): string
    {
        return 'stocktake-lines';
    }

    public function title(): string
    {
        return trim('Stocktake '.$this->number);
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('variant.product_name', 'Product'),
            ExportColumn::text('variant.name', 'Variant'),
            ExportColumn::text('variant.sku', 'SKU'),
            ExportColumn::text('variant.barcode', 'Barcode'),
            ExportColumn::text('batch.number', 'Batch'),
            ExportColumn::date('batch.expires_on', 'Expires'),
            ExportColumn::quantity('system_quantity', 'System'),
            ExportColumn::quantity('counted_quantity', 'Counted'),
            ExportColumn::quantity('difference', 'Difference'),
            ExportColumn::money('value_difference', 'Value difference'),
            ExportColumn::text('counted_by.name', 'Counted by'),
            ExportColumn::dateTime('counted_at', 'Counted at'),
            ExportColumn::text('note', 'Note'),
        ];
    }

    public function filters(Request $request): array
    {
        return FilterSummary::of($request)->search()->value('filter', 'Lines')->all();
    }
}
