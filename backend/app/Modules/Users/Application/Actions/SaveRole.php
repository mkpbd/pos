<?php

namespace App\Modules\Users\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Users\Application\Services\PrivilegeEscalationGuard;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Creates or updates a custom role. Built-in (system) roles are read-only.
 */
class SaveRole
{
    public function __construct(
        private readonly PrivilegeEscalationGuard $guard,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{name: string, description?: ?string, permissions: list<string>}  $data
     */
    public function __invoke(?Role $role, array $data, ?User $actor = null): Role
    {
        if ($role?->isSystem()) {
            throw new BusinessRuleViolation('SYSTEM_ROLE_READ_ONLY', 'Built-in roles cannot be changed. Create a custom role instead.');
        }

        // The actor must hold every permission the role has now and will have afterwards.
        $this->guard->assertCanGrantPermissions($actor, array_merge(
            $data['permissions'],
            $role?->permissions()->pluck('name')->all() ?? [],
        ));

        return DB::transaction(function () use ($role, $data) {
            $creating = $role === null;
            $role ??= new Role;
            $before = $creating ? [] : $this->snapshot($role);

            $role->fill(['name' => $data['name'], 'description' => $data['description'] ?? null])->save();
            $role->permissions()->sync(array_values(array_unique($data['permissions'])));

            [$old, $new] = Changes::between($before, $this->snapshot($role));
            $this->audit->record($creating ? 'role.created' : 'role.updated', $role, $old, $new);

            return $role;
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(Role $role): array
    {
        return [
            'name' => $role->name,
            'description' => $role->description,
            'permissions' => $role->permissions()->pluck('name')->sort()->values()->all(),
        ];
    }
}
