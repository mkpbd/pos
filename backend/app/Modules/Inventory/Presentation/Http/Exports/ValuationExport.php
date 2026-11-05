<?php

namespace App\Modules\Inventory\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use Illuminate\Http\Request;

/**
 * GET /inventory/valuation?export=xlsx|pdf — value of positive stock per store, with a total row.
 */
class ValuationExport extends InventoryListExport
{
    public function name(): string
    {
        return 'stock-valuation';
    }

    public function title(): string
    {
        return 'Inventory valuation';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('store.name', 'Store'),
            ExportColumn::text('store.branch_name', 'Branch'),
            ExportColumn::number('products', 'Products'),
            ExportColumn::money('value', 'Value'),
        ];
    }

    public function filters(Request $request): array
    {
        return $this->summary($request)->all();
    }
}
