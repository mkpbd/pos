<?php

namespace App\Modules\Purchasing\Presentation\Http\Exports;

use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExport;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Illuminate\Http\Request;

/**
 * Shared filter vocabulary of the Purchasing module's exports (supplier by name).
 */
abstract class PurchasingListExport extends ListExport
{
    public function __construct(
        protected readonly TenantContext $tenant,
        protected readonly SupplierDirectory $suppliers,
    ) {}

    protected function summary(Request $request): FilterSummary
    {
        return FilterSummary::of($request)
            ->search()
            ->lookup('supplier_id', 'Supplier', fn (string $id) => $this->suppliers->find($id, $this->tenant->requireOrganization())['name'] ?? null);
    }
}
