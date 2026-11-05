<?php

namespace App\Modules\Purchasing\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use Illuminate\Http\Request;

/**
 * GET /purchasing/returns?export=xlsx|pdf
 */
class PurchaseReturnsExport extends PurchasingListExport
{
    public function name(): string
    {
        return 'purchase-returns';
    }

    public function title(): string
    {
        return 'Purchase returns';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('number', 'Return'),
            ExportColumn::dateTime('created_at', 'Date'),
            ExportColumn::text('supplier.name', 'Supplier'),
            ExportColumn::text('store.name', 'Store'),
            ExportColumn::text('reason', 'Reason'),
            ExportColumn::money('subtotal', 'Subtotal'),
            ExportColumn::money('tax_total', 'Tax'),
            ExportColumn::money('total', 'Total'),
        ];
    }

    public function filters(Request $request): array
    {
        return $this->summary($request)->all();
    }
}
