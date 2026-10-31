<?php

namespace App\Modules\Users\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Users\Application\DTOs\UserData;
use App\Modules\Users\Application\Services\PrivilegeEscalationGuard;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Support\Facades\DB;

class CreateUser
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly AssignUserAccess $assignAccess,
        private readonly PrivilegeEscalationGuard $guard,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  User|null  $actor  NULL for system processes (provisioning, seeding)
     */
    public function __invoke(UserData $data, ?User $actor = null): User
    {
        $organizationId = $this->tenant->requireOrganization();
        $this->guard->assertCanAssignRoles($actor, $data->roleIds);

        return DB::transaction(function () use ($data, $organizationId) {
            $user = User::query()->create([
                'organization_id' => $organizationId,
                'name' => $data->name,
                'email' => $data->email,
                'phone' => $data->phone,
                'password' => $data->password,
                'status' => $data->status,
            ]);

            ($this->assignAccess)($user, $data->roleIds, $data->branchIds);

            $this->audit->record('user.created', $user, new: [
                'name' => $user->name,
                'email' => $user->email,
                'status' => $user->status->value,
                'role_ids' => $data->roleIds,
                'branch_ids' => $data->branchIds,
            ]);

            return $user;
        });
    }
}
