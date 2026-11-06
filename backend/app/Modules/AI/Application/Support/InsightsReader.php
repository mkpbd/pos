<?php

namespace App\Modules\AI\Application\Support;

use App\Modules\Shared\Application\Contracts\TenantUser;
use Illuminate\Contracts\Auth\Access\Authorizable;

/**
 * The "user" the insights are computed for when no person is behind the request: the scheduled
 * daily insights job, and cached insights of a whole scope (the organization or one branch)
 * that are later served to users who may see that scope. It reads reports for its branch scope,
 * sees cost figures only when built with `canViewCost` (cached insights are stored per cost
 * visibility) and holds no other permission — in particular nothing that writes.
 */
final readonly class InsightsReader implements Authorizable, TenantUser
{
    private const ABILITIES = ['reports.view', 'dashboard.view', 'purchases.view'];

    /**
     * @param  list<string>|null  $branchIds  NULL = every branch of the organization
     */
    public function __construct(
        private string $organizationId,
        private ?array $branchIds,
        private bool $canViewCost,
    ) {}

    /**
     * @param  iterable<string>|string  $abilities
     * @param  array<mixed>|mixed  $arguments
     */
    public function can($abilities, $arguments = []): bool
    {
        foreach (is_iterable($abilities) ? $abilities : [$abilities] as $ability) {
            $allowed = $ability === 'products.view_cost' ? $this->canViewCost : in_array($ability, self::ABILITIES, true);
            if (! $allowed) {
                return false;
            }
        }

        return true;
    }

    public function getAuthIdentifier()
    {
        return null;
    }

    public function organizationId(): ?string
    {
        return $this->organizationId;
    }

    public function isPlatformAdmin(): bool
    {
        return false;
    }

    public function isActive(): bool
    {
        return true;
    }

    public function canAccessBranch(string $branchId): bool
    {
        return $this->branchIds === null || in_array($branchId, $this->branchIds, true);
    }

    public function accessibleBranchIds(): ?array
    {
        return $this->branchIds;
    }
}
