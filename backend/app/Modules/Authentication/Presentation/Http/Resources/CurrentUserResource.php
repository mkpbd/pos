<?php

namespace App\Modules\Authentication\Presentation\Http\Resources;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Authorization\PermissionRegistry;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Everything the SPA needs to bootstrap a session: identity, tenant,
 * accessible branches and effective permissions.
 *
 * @mixin User
 */
class CurrentUserResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $organization = $this->organization_id ? app(OrganizationDirectory::class)->summary($this->organization_id) : null;

        $permissions = $this->isPlatformAdmin()
            ? array_keys(app(PermissionRegistry::class)->all())
            : array_keys($this->permissionNames());
        sort($permissions);

        return [
            'user' => [
                'id' => $this->id,
                'name' => $this->name,
                'email' => $this->email,
                'phone' => $this->phone,
                'is_platform_admin' => $this->is_platform_admin,
                'last_login_at' => $this->last_login_at?->toIso8601String(),
            ],
            'organization' => $organization,
            'roles' => $this->roles()->get(['roles.id', 'roles.name', 'roles.system_key'])->map(fn ($role) => [
                'id' => $role->id,
                'name' => $role->name,
                'system_key' => $role->system_key?->value,
            ])->values(),
            'permissions' => $permissions,
            'branches' => $organization
                ? app(BranchDirectory::class)->summaries($this->organization_id, $this->accessibleBranchIds())
                : [],
        ];
    }
}
