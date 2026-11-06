<?php

namespace App\Modules\Branches\Application\Contracts;

/**
 * Read access to branches for other modules (tenancy, users).
 */
interface BranchDirectory
{
    /**
     * Whether the branch exists, is active and belongs to the organization.
     */
    public function isActiveBranchOf(string $branchId, string $organizationId): bool;

    /**
     * Ids of the given branches that belong to the organization (silently drops foreign ids).
     *
     * @param  list<string>  $branchIds
     * @return list<string>
     */
    public function filterOwned(array $branchIds, string $organizationId): array;

    /**
     * @param  list<string>|null  $branchIds  NULL = all branches of the organization
     * @return list<array{id: string, code: string, name: string, is_active: bool}>
     */
    public function summaries(string $organizationId, ?array $branchIds = null): array;

    /**
     * A store (stock location) of the organization with its branch's stock policy.
     *
     * @return array{id: string, code: string, name: string, branch_id: string, branch_code: string, branch_name: string, is_active: bool, branch_is_active: bool, allow_negative_stock: bool}|null
     */
    public function store(string $storeId, string $organizationId): ?array;

    /**
     * @param  list<string>  $storeIds
     * @return array<string, array{id: string, code: string, name: string, branch_id: string, branch_name: string}>
     */
    public function storeSummaries(string $organizationId, array $storeIds): array;

    /**
     * Active stores of active branches of the organization, by branch and store name.
     *
     * @return list<array{id: string, code: string, name: string, branch_id: string, branch_name: string}>
     */
    public function activeStores(string $organizationId): array;

    /**
     * Contact details printed on documents (receipts, invoices).
     *
     * @return array{id: string, code: string, name: string, address: ?string, phone: ?string, email: ?string}|null
     */
    public function profile(string $branchId, string $organizationId): ?array;
}
