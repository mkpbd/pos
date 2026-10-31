<?php

namespace App\Modules\Users\Application\Actions;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Validation\ValidationException;

/**
 * Replaces a user's roles and branch memberships after checking that every
 * referenced role and branch belongs to the user's organization.
 */
class AssignUserAccess
{
    public function __construct(private readonly BranchDirectory $branches) {}

    /**
     * @param  list<string>|null  $roleIds  NULL = leave unchanged
     * @param  list<string>|null  $branchIds  NULL = leave unchanged
     */
    public function __invoke(User $user, ?array $roleIds, ?array $branchIds): void
    {
        $organizationId = (string) $user->organization_id;

        if ($roleIds !== null) {
            $roleIds = array_values(array_unique($roleIds));
            $owned = Role::query()->withoutGlobalScope('organization')
                ->where('organization_id', $organizationId)->whereKey($roleIds)->pluck('id')->all();

            if (count($owned) !== count($roleIds)) {
                throw ValidationException::withMessages(['role_ids' => ['One or more roles do not exist.']]);
            }

            $user->roles()->sync($roleIds);
        }

        if ($branchIds !== null) {
            $branchIds = array_values(array_unique($branchIds));
            if (count($this->branches->filterOwned($branchIds, $organizationId)) !== count($branchIds)) {
                throw ValidationException::withMessages(['branch_ids' => ['One or more branches do not exist.']]);
            }

            $user->branchMemberships()->delete();
            $user->branchMemberships()->createMany(array_map(fn (string $branchId) => ['branch_id' => $branchId], $branchIds));
        }

        $user->flushAccessCache();
    }
}
