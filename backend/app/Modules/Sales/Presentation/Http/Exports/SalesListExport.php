<?php

namespace App\Modules\Sales\Presentation\Http\Exports;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExport;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Http\Request;

/**
 * Shared filter vocabulary of the Sales module's exports (branch, store, customer by name).
 */
abstract class SalesListExport extends ListExport
{
    public function __construct(
        protected readonly TenantContext $tenant,
        protected readonly BranchDirectory $branches,
        protected readonly CustomerDirectory $customers,
        protected readonly UserDirectory $users,
    ) {}

    protected function summary(Request $request): FilterSummary
    {
        $org = $this->tenant->requireOrganization();

        return FilterSummary::of($request)
            ->search()
            ->lookup('branch_id', 'Branch', fn (string $id) => $this->branches->profile($id, $org)['name'] ?? null)
            ->lookup('store_id', 'Store', fn (string $id) => $this->branches->store($id, $org)['name'] ?? null)
            ->lookup('customer_id', 'Customer', fn (string $id) => $this->customers->find($id, $org)['name'] ?? null);
    }

    protected function userName(string $id): ?string
    {
        return $this->users->names($this->tenant->requireOrganization(), [$id])[$id] ?? null;
    }
}
