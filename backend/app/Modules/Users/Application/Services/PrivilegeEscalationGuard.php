<?php

namespace App\Modules\Users\Application\Services;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Nobody can hand out more power than they hold: an actor may only grant
 * permissions (directly on a role, or by assigning roles to a user) that the
 * actor has. Platform admins and system processes (no actor) are exempt.
 */
class PrivilegeEscalationGuard
{
    /**
     * @param  list<string>  $permissions
     */
    public function assertCanGrantPermissions(?User $actor, array $permissions): void
    {
        if ($actor === null || $actor->isPlatformAdmin()) {
            return;
        }

        $missing = array_values(array_diff(array_unique($permissions), array_keys($actor->permissionNames())));
        sort($missing);

        if ($missing !== []) {
            throw new BusinessRuleViolation(
                'PRIVILEGE_ESCALATION',
                'You cannot grant permissions you do not have yourself.',
                ['permissions' => $missing],
            );
        }
    }

    /**
     * An actor may only edit users who are not more powerful than the actor
     * (otherwise e.g. resetting an admin's password would hand over the admin account).
     */
    public function assertCanManageUser(?User $actor, User $target): void
    {
        if ($actor === null || $actor->isPlatformAdmin() || $actor->is($target)) {
            return;
        }

        if ($target->isPlatformAdmin()) {
            throw new BusinessRuleViolation('PRIVILEGE_ESCALATION', 'Platform administrators can only be managed by platform administrators.');
        }

        $this->assertCanGrantPermissions($actor, array_keys($target->permissionNames()));
    }

    /**
     * @param  list<string>  $roleIds
     */
    public function assertCanAssignRoles(?User $actor, array $roleIds): void
    {
        if ($actor === null || $actor->isPlatformAdmin() || $roleIds === []) {
            return;
        }

        $this->assertCanGrantPermissions($actor, DB::table('permission_role')
            ->whereIn('role_id', $roleIds)
            ->distinct()
            ->pluck('permission_name')
            ->all());
    }
}
