<?php

namespace App\Modules\Purchasing\Application\Services;

use App\Modules\Purchasing\Domain\Procurement\ApprovalLevel;
use App\Modules\Purchasing\Domain\Procurement\ApprovalPolicy;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseApprovalSettings;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Notifications\RoutesNotifications;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Gate;

/**
 * The organization's approval limits and who may approve what (SC2): the amount decides the
 * level, the level decides the permission; the approver must work in the document's branch
 * and must not be the person who raised or submitted it.
 */
class ApprovalRules
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly UserDirectory $users,
    ) {}

    /**
     * Saved settings, or the defaults (10 000.00 / 100 000.00 / PO approval on).
     *
     * @return array{auto_approve_limit: string, manager_limit: string, require_po_approval: bool, updated_at: ?string}
     */
    public function settings(?string $organizationId = null): array
    {
        $organizationId ??= $this->tenant->requireOrganization();
        $row = PurchaseApprovalSettings::query()->withoutGlobalScope('organization')->where('organization_id', $organizationId)->first();

        return [
            'auto_approve_limit' => $row->auto_approve_limit ?? PurchaseApprovalSettings::DEFAULTS['auto_approve_limit'],
            'manager_limit' => $row->manager_limit ?? PurchaseApprovalSettings::DEFAULTS['manager_limit'],
            'require_po_approval' => $row->require_po_approval ?? PurchaseApprovalSettings::DEFAULTS['require_po_approval'],
            'updated_at' => $row?->updated_at?->toIso8601String(),
        ];
    }

    public function levelFor(string $amount, ?array $settings = null): ApprovalLevel
    {
        $settings ??= $this->settings();

        return ApprovalPolicy::level($amount, $settings['auto_approve_limit'], $settings['manager_limit']);
    }

    public function has(TenantUser $user, string $permission): bool
    {
        return $user instanceof Authenticatable && Gate::forUser($user)->allows($permission);
    }

    /**
     * @param  list<string>  $permissions
     */
    public function hasAny(TenantUser $user, array $permissions): bool
    {
        foreach ($permissions as $permission) {
            if ($this->has($user, $permission)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  list<string>  $permissions
     *
     * @throws AuthorizationException
     */
    public function requireAny(TenantUser $user, array $permissions): void
    {
        if (! $this->hasAny($user, $permissions)) {
            throw new AuthorizationException('This action is unauthorized.');
        }
    }

    /**
     * Levels the user may approve at (by permission only).
     *
     * @return list<ApprovalLevel>
     */
    public function approvableLevels(TenantUser $user): array
    {
        return array_values(array_filter(
            [ApprovalLevel::Manager, ApprovalLevel::High],
            fn (ApprovalLevel $level) => $this->hasAny($user, $level->approverPermissions()),
        ));
    }

    /**
     * @param  list<?string>  $ownerIds  requester / creator / submitter — never the approver
     */
    public function canApprove(TenantUser $user, ?ApprovalLevel $level, string $branchId, array $ownerIds): bool
    {
        return $level !== null && $level !== ApprovalLevel::None
            && $user->canAccessBranch($branchId)
            && ! in_array((string) $user->getAuthIdentifier(), array_filter($ownerIds), true)
            && $this->hasAny($user, $level->approverPermissions());
    }

    /**
     * @param  list<?string>  $ownerIds
     *
     * @throws BusinessRuleViolation SELF_APPROVAL_NOT_ALLOWED / APPROVAL_LIMIT_EXCEEDED (403)
     */
    public function assertCanApprove(TenantUser $user, ApprovalLevel $level, string $branchId, array $ownerIds, string $amount): void
    {
        if (in_array((string) $user->getAuthIdentifier(), array_filter($ownerIds), true)) {
            throw new BusinessRuleViolation('SELF_APPROVAL_NOT_ALLOWED', 'You cannot approve or reject a document you raised or submitted yourself.', [], 403);
        }
        if (! $user->canAccessBranch($branchId) || ! $this->hasAny($user, $level->approverPermissions())) {
            throw new BusinessRuleViolation('APPROVAL_LIMIT_EXCEEDED', 'Your approval permissions do not cover this amount.', [
                'approval_level' => $level->value,
                'required_permission' => $level->requiredPermission(),
                'amount' => $amount,
            ], 403);
        }
    }

    /**
     * Active users who may approve at the level in the branch, minus the owners.
     *
     * @param  list<?string>  $ownerIds
     * @return Collection<int, Authenticatable&RoutesNotifications>
     */
    public function approvers(string $organizationId, ApprovalLevel $level, string $branchId, array $ownerIds): Collection
    {
        $owners = array_filter($ownerIds);

        return collect($level->approverPermissions())
            ->flatMap(fn (string $permission) => $this->users->withPermissionInBranch($organizationId, $permission, $branchId))
            ->unique(fn ($user) => $user->getAuthIdentifier())
            ->reject(fn ($user) => in_array((string) $user->getAuthIdentifier(), $owners, true))
            ->values();
    }
}
