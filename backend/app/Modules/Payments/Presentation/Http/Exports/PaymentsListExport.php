<?php

namespace App\Modules\Payments\Presentation\Http\Exports;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExport;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Http\Request;

/**
 * Shared vocabulary of the Payments module's exports (branch and user names).
 */
abstract class PaymentsListExport extends ListExport
{
    /** @var array<string, string>|null */
    private ?array $branchNames = null;

    public function __construct(
        protected readonly TenantContext $tenant,
        protected readonly BranchDirectory $branches,
        protected readonly UserDirectory $users,
    ) {}

    protected function summary(Request $request): FilterSummary
    {
        return FilterSummary::of($request)
            ->search()
            ->lookup('branch_id', 'Branch', fn (string $id) => $this->branchName($id));
    }

    protected function branchName(?string $id): ?string
    {
        $this->branchNames ??= collect($this->branches->summaries($this->tenant->requireOrganization()))->pluck('name', 'id')->all();

        return $id === null ? null : ($this->branchNames[$id] ?? null);
    }

    protected function userName(string $id): ?string
    {
        return $this->users->names($this->tenant->requireOrganization(), [$id])[$id] ?? null;
    }
}
