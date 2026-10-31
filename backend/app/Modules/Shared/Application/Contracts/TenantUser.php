<?php

namespace App\Modules\Shared\Application\Contracts;

/**
 * What the platform needs to know about an authenticated user to resolve tenancy,
 * without depending on the Users module's model.
 */
interface TenantUser
{
    public function getAuthIdentifier();

    /** NULL for platform administrators. */
    public function organizationId(): ?string;

    public function isPlatformAdmin(): bool;

    public function isActive(): bool;

    public function canAccessBranch(string $branchId): bool;

    /**
     * Branch ids the user may work in, or NULL when the user may access every branch of the organization.
     *
     * @return list<string>|null
     */
    public function accessibleBranchIds(): ?array;
}
