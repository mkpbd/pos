<?php

namespace App\Modules\Purchasing\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use Illuminate\Http\Request;

/**
 * GET /purchasing/orders?export=xlsx|pdf
 */
class PurchaseOrdersExport extends PurchasingListExport
{
    public function name(): string
    {
        return 'purchase-orders';
    }

    public function title(): string
    {
        return 'Purchase orders';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('number', 'Order'),
            ExportColumn::date('order_date', 'Order date'),
            ExportColumn::date('expected_date', 'Expected'),
            ExportColumn::text('supplier.name', 'Supplier'),
            ExportColumn::text('store.name', 'Store'),
            ExportColumn::money('subtotal', 'Subtotal'),
            ExportColumn::money('tax_total', 'Tax'),
            ExportColumn::money('total', 'Total'),
            ExportColumn::status('status', 'Status'),
        ];
    }

    public function filters(Request $request): array
    {
        return $this->summary($request)->value('status', 'Status')->all();
    }
}
