<?php

namespace App\Modules\Purchasing\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use Illuminate\Http\Request;

/**
 * GET /purchasing/receipts?export=xlsx|pdf — goods receipts (supplier invoices).
 */
class GoodsReceiptsExport extends PurchasingListExport
{
    public function name(): string
    {
        return 'goods-receipts';
    }

    public function title(): string
    {
        return 'Goods receipts';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('number', 'Receipt'),
            ExportColumn::date('invoice_date', 'Invoice date'),
            ExportColumn::text('supplier_invoice_number', 'Supplier invoice'),
            ExportColumn::text('supplier.name', 'Supplier'),
            ExportColumn::text('store.name', 'Store'),
            ExportColumn::date('due_date', 'Due date'),
            ExportColumn::money('subtotal', 'Subtotal'),
            ExportColumn::money('tax_total', 'Tax'),
            ExportColumn::money('total', 'Total'),
        ];
    }

    public function filters(Request $request): array
    {
        return $this->summary($request)->dates(label: 'Invoice date')->all();
    }
}
