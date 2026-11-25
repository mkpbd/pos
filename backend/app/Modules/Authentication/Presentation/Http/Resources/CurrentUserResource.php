<?php

namespace App\Modules\Authentication\Presentation\Http\Resources;

use App\Modules\Authentication\Application\Services\TwoFactorPolicy;
use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Authorization\PermissionRegistry;
use App\Modules\Shared\Application\Contracts\AiFeatures;
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

        $twoFactorRequired = app(TwoFactorPolicy::class)->requiredFor($this->resource);

        return [
            'user' => [
                'id' => $this->id,
                'name' => $this->name,
                'email' => $this->email,
                'phone' => $this->phone,
                'is_platform_admin' => $this->is_platform_admin,
                'last_login_at' => $this->last_login_at?->toIso8601String(),
                'pin_set' => $this->hasPin(),
            ],
            // POS1a: a till PIN is set (also in `user.pin_set`).
            'pin_set' => $this->hasPin(),
            'organization' => $organization,
            'roles' => $this->roles()->get(['roles.id', 'roles.name', 'roles.system_key'])->map(fn ($role) => [
                'id' => $role->id,
                'name' => $role->name,
                'system_key' => $role->system_key?->value,
            ])->values(),
            'permissions' => $permissions,
            // G1a: `setup_required` — the organization requires two-factor sign-in and it is not set up:
            // every other staff route answers 403 TWO_FACTOR_SETUP_REQUIRED until it is.
            'two_factor' => [
                'enabled' => $this->hasTwoFactorEnabled(),
                'required' => $twoFactorRequired,
                'setup_required' => $twoFactorRequired && ! $this->hasTwoFactorEnabled(),
            ],
            // Phase 8: whether AI summaries / the assistant are on for the organization (app + organization switch).
            'ai_enabled' => app(AiFeatures::class)->enabledFor($this->organization_id),
            'branches' => $organization
                ? app(BranchDirectory::class)->summaries($this->organization_id, $this->accessibleBranchIds())
                : [],
        ];
    }
}
