<?php

namespace App\Modules\Purchasing\Application\Services;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Illuminate\Validation\ValidationException;

/**
 * Lookups every purchasing document needs: the organization's currency and a usable supplier.
 */
class PurchasingContext
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
        private readonly SupplierDirectory $suppliers,
    ) {}

    public function organizationId(): string
    {
        return $this->tenant->requireOrganization();
    }

    public function currency(): string
    {
        return $this->organizations->summary($this->organizationId())['base_currency'] ?? config('pos.default_currency');
    }

    /**
     * @return array{id: string, code: string, name: string, is_active: bool, archived: bool, opening_balance: string, payment_terms_days: int}
     */
    public function requireActiveSupplier(string $supplierId, string $field = 'supplier_id'): array
    {
        $supplier = $this->suppliers->find($supplierId, $this->organizationId());

        if ($supplier === null || $supplier['archived']) {
            throw ValidationException::withMessages([$field => ['The selected supplier does not exist.']]);
        }
        if (! $supplier['is_active']) {
            throw ValidationException::withMessages([$field => ['The selected supplier is inactive.']]);
        }

        return $supplier;
    }
}
