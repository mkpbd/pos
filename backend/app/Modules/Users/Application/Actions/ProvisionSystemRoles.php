<?php

namespace App\Modules\Users\Application\Actions;

use App\Modules\Shared\Application\Authorization\PermissionRegistry;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;

/**
 * Creates (or refreshes) the built-in roles of one organization and
 * re-derives their permission sets from the current catalog.
 */
class ProvisionSystemRoles
{
    public function __construct(private readonly PermissionRegistry $registry) {}

    /**
     * @return array<string, Role> keyed by SystemRole value
     */
    public function __invoke(string $organizationId): array
    {
        $roles = [];

        foreach (SystemRole::cases() as $systemRole) {
            $role = Role::query()
                ->withoutGlobalScope('organization')
                ->firstOrNew(['organization_id' => $organizationId, 'system_key' => $systemRole->value]);

            $role->fill([
                'organization_id' => $organizationId,
                'name' => $systemRole->label(),
                'description' => $systemRole->description(),
            ])->save();

            $role->permissions()->sync($this->registry->matching($systemRole->permissionPatterns()));
            $roles[$systemRole->value] = $role;
        }

        return $roles;
    }
}
