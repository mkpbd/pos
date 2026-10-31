<?php

namespace App\Modules\Inventory\Application\Services;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Validation\ValidationException;

/**
 * Resolves a store for a document and checks the user may work in its branch.
 * Stores of branches the user cannot access are reported as not existing.
 */
class StoreAccess
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly BranchDirectory $branches,
    ) {}

    /**
     * @return array{id: string, code: string, name: string, branch_id: string, branch_name: string, is_active: bool, branch_is_active: bool, allow_negative_stock: bool}
     *
     * @throws ValidationException
     */
    public function require(TenantUser $user, string $storeId, string $field = 'store_id'): array
    {
        $store = $this->branches->store($storeId, $this->tenant->requireOrganization());

        if ($store === null || ! $user->canAccessBranch($store['branch_id'])) {
            throw ValidationException::withMessages([$field => ['The selected store does not exist.']]);
        }
        if (! $store['is_active'] || ! $store['branch_is_active']) {
            throw ValidationException::withMessages([$field => ['The selected store is inactive.']]);
        }

        return $store;
    }
}
