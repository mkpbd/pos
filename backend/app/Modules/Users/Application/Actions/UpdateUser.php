<?php

namespace App\Modules\Users\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Users\Application\Services\PrivilegeEscalationGuard;
use App\Modules\Users\Domain\Enums\UserStatus;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Partial update of a user by an administrator.
 *
 * Guards against lock-out: administrators cannot change their own status or roles,
 * and the organization always keeps at least one active Organization Admin.
 * Guards against escalation: actors cannot edit more powerful users or assign roles
 * carrying permissions they lack.
 * Deactivation and password changes revoke the user's sessions and tokens.
 */
class UpdateUser
{
    public function __construct(
        private readonly AssignUserAccess $assignAccess,
        private readonly PrivilegeEscalationGuard $guard,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{name?: string, email?: string, phone?: ?string, status?: string, password?: string, role_ids?: list<string>, branch_ids?: list<string>}  $changes
     */
    public function __invoke(User $user, array $changes, User $actor): User
    {
        if ($user->is($actor) && (isset($changes['status']) || isset($changes['role_ids']))) {
            throw new BusinessRuleViolation('CANNOT_MODIFY_OWN_ACCESS', 'You cannot change your own status or roles.');
        }

        $this->guard->assertCanManageUser($actor, $user);
        if (isset($changes['role_ids'])) {
            $this->guard->assertCanAssignRoles($actor, $changes['role_ids']);
        }

        return DB::transaction(function () use ($user, $changes) {
            $before = $this->snapshot($user);
            $wasAdmin = $this->isActiveAdmin($user);

            $user->fill(array_filter([
                'name' => $changes['name'] ?? null,
                'email' => isset($changes['email']) ? mb_strtolower($changes['email']) : null,
                'status' => $changes['status'] ?? null,
                'password' => $changes['password'] ?? null,
            ], fn ($v) => $v !== null));

            if (array_key_exists('phone', $changes)) {
                $user->phone = $changes['phone'];
            }

            $passwordChanged = $user->isDirty('password');
            $user->save();

            ($this->assignAccess)($user, $changes['role_ids'] ?? null, $changes['branch_ids'] ?? null);

            if ($wasAdmin && ! $this->isActiveAdmin($user)) {
                $this->assertAnotherActiveAdminExists($user);
            }

            if ($passwordChanged || $user->status === UserStatus::Inactive) {
                $this->revokeAccess($user);
            }

            [$old, $new] = Changes::between($before, $this->snapshot($user));
            $this->audit->record('user.updated', $user, $old, $new,
                context: $passwordChanged ? ['password_changed' => true] : [],
            );

            return $user;
        });
    }

    private function isActiveAdmin(User $user): bool
    {
        return $user->status === UserStatus::Active
            && $user->roles()->where('system_key', SystemRole::OrganizationAdmin->value)->exists();
    }

    private function assertAnotherActiveAdminExists(User $user): void
    {
        // Locking the admin role row serialises concurrent demotions of the last two admins.
        $adminRole = Role::query()->withoutGlobalScope('organization')
            ->where('organization_id', $user->organization_id)
            ->where('system_key', SystemRole::OrganizationAdmin->value)
            ->lockForUpdate()
            ->first();

        $others = $adminRole?->users()
            ->where('users.id', '!=', $user->id)
            ->where('users.status', UserStatus::Active->value)
            ->count() ?? 0;

        if ($others === 0) {
            throw new BusinessRuleViolation('LAST_ORGANIZATION_ADMIN', 'The organization must keep at least one active Organization Admin.');
        }
    }

    private function revokeAccess(User $user): void
    {
        $user->tokens()->delete();
        DB::table('sessions')->where('user_id', $user->id)->delete();
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(User $user): array
    {
        return [
            'name' => $user->name,
            'email' => $user->email,
            'phone' => $user->phone,
            'status' => $user->status->value,
            'role_ids' => $user->roles()->pluck('roles.id')->sort()->values()->all(),
            'branch_ids' => collect($user->assignedBranchIds())->sort()->values()->all(),
        ];
    }
}
