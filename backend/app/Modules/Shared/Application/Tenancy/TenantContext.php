<?php

namespace App\Modules\Shared\Application\Tenancy;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * Request-scoped tenant (organization) and active branch.
 *
 * Resolved by the ResolveTenant middleware from the authenticated user and the
 * X-Branch-Id header. Tenant-owned models read it to scope queries and stamp inserts.
 */
final class TenantContext
{
    private ?string $organizationId = null;

    private ?string $branchId = null;

    public function setOrganization(?string $organizationId): void
    {
        $this->organizationId = $organizationId;
        $this->branchId = null;
    }

    public function setBranch(?string $branchId): void
    {
        $this->branchId = $branchId;
    }

    public function hasOrganization(): bool
    {
        return $this->organizationId !== null;
    }

    public function organizationId(): ?string
    {
        return $this->organizationId;
    }

    public function requireOrganization(): string
    {
        return $this->organizationId
            ?? throw new BusinessRuleViolation('ORGANIZATION_CONTEXT_REQUIRED', 'No organization is selected for this request.');
    }

    public function branchId(): ?string
    {
        return $this->branchId;
    }

    public function requireBranch(): string
    {
        return $this->branchId
            ?? throw new BusinessRuleViolation('BRANCH_CONTEXT_REQUIRED', 'Select a branch (X-Branch-Id header) for this request.');
    }

    /**
     * Run $callback with a different organization in context (console jobs, provisioning).
     *
     * @template T
     *
     * @param  callable(): T  $callback
     * @return T
     */
    public function runAs(?string $organizationId, callable $callback, ?string $branchId = null): mixed
    {
        [$org, $branch] = [$this->organizationId, $this->branchId];
        $this->organizationId = $organizationId;
        $this->branchId = $branchId;

        try {
            return $callback();
        } finally {
            [$this->organizationId, $this->branchId] = [$org, $branch];
        }
    }
}
