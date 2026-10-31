<?php

namespace App\Modules\Users\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Users\Infrastructure\Models\Role;
use Illuminate\Support\Facades\DB;

class DeleteRole
{
    public function __construct(private readonly AuditTrail $audit) {}

    public function __invoke(Role $role): void
    {
        if ($role->isSystem()) {
            throw new BusinessRuleViolation('SYSTEM_ROLE_READ_ONLY', 'Built-in roles cannot be deleted.');
        }

        DB::transaction(function () use ($role) {
            $assigned = $role->users()->count();
            if ($assigned > 0) {
                throw new BusinessRuleViolation('ROLE_IN_USE', 'Remove this role from all users before deleting it.', ['users' => $assigned]);
            }

            $this->audit->record('role.deleted', $role, old: [
                'name' => $role->name,
                'permissions' => $role->permissions()->pluck('name')->all(),
            ]);
            $role->delete();
        });
    }
}
