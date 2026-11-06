<?php

namespace App\Modules\Purchasing\Presentation\Http\Exports;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Illuminate\Http\Request;

/**
 * GET /purchasing/reorder-suggestions?store_id=…&export=xlsx|pdf
 */
class ReorderSuggestionsExport extends PurchasingListExport
{
    public function __construct(TenantContext $tenant, SupplierDirectory $suppliers, private readonly BranchDirectory $branches)
    {
        parent::__construct($tenant, $suppliers);
    }

    public function name(): string
    {
        return 'reorder-suggestions';
    }

    public function title(): string
    {
        return 'Reorder suggestions';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('variant.product_name', 'Product'),
            ExportColumn::text('variant.variant_name', 'Variant'),
            ExportColumn::text('variant.sku', 'SKU'),
            ExportColumn::quantity('on_hand', 'On hand'),
            ExportColumn::quantity('on_order', 'On order'),
            ExportColumn::quantity('in_transit', 'In transit'),
            ExportColumn::quantity('avg_daily', 'Avg. daily'),
            ExportColumn::number('days_of_cover', 'Days of cover'),
            ExportColumn::quantity('reorder_point', 'Reorder point'),
            ExportColumn::quantity('target', 'Target'),
            ExportColumn::quantity('suggested_transfer', 'Transfer'),
            ExportColumn::quantity('suggested_purchase', 'Purchase'),
            ExportColumn::text('supplier.name', 'Supplier'),
            ExportColumn::money('unit_cost', 'Unit cost'),
            ExportColumn::number('lead_time_days', 'Lead time (days)'),
            ExportColumn::status('reason', 'Reason'),
        ];
    }

    public function filters(Request $request): array
    {
        return $this->summary($request)
            ->lookup('store_id', 'Store', fn (string $id) => $this->branches->store($id, $this->tenant->requireOrganization())['name'] ?? null)
            ->value('only', 'Show')
            ->all();
    }
}
