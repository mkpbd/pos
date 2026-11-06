<?php

namespace App\Modules\Purchasing\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use Illuminate\Http\Request;

/**
 * GET /purchasing/supplier-products?export=xlsx|pdf
 */
class SupplierCatalogExport extends PurchasingListExport
{
    public function name(): string
    {
        return 'supplier-catalog';
    }

    public function title(): string
    {
        return 'Supplier catalog';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('variant.product_name', 'Product'),
            ExportColumn::text('variant.variant_name', 'Variant'),
            ExportColumn::text('variant.sku', 'SKU'),
            ExportColumn::text('supplier.name', 'Supplier'),
            ExportColumn::text('supplier_sku', 'Supplier SKU'),
            ExportColumn::money('unit_cost', 'Unit cost'),
            ExportColumn::quantity('pack_size', 'Pack size'),
            ExportColumn::quantity('min_order_qty', 'Min. order'),
            ExportColumn::number('lead_time_days', 'Lead time (days)'),
            ExportColumn::yesNo('is_preferred', 'Preferred'),
            ExportColumn::money('last_purchase_cost', 'Last cost'),
            ExportColumn::dateTime('last_purchased_at', 'Last purchased'),
            ExportColumn::yesNo('is_active', 'Active'),
        ];
    }

    public function filters(Request $request): array
    {
        return $this->summary($request)
            ->boolean('is_active', 'Active')
            ->flag('is_preferred', 'Preferred only')
            ->all();
    }
}
