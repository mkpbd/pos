<?php

namespace App\Modules\Authentication\Application\Services;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Contracts\TwoFactorOverview;
use App\Modules\Users\Domain\Enums\UserStatus;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Database\Eloquent\Builder;

/**
 * G1a: the organization's two-factor policy (`settings.two_factor_policy`):
 * - `optional` (default): nobody is forced;
 * - `admins`: users holding users.manage, roles.manage or organization.update through a role;
 * - `everyone`: every staff user of the organization.
 * Platform administrators (no organization) are never forced by an organization; they may opt in.
 */
class TwoFactorPolicy implements TwoFactorOverview
{
    public const OPTIONAL = 'optional';

    public const ADMINS = 'admins';

    public const EVERYONE = 'everyone';

    /** Permissions that make a user an administrator for the `admins` policy. */
    public const ADMIN_PERMISSIONS = ['users.manage', 'roles.manage', 'organization.update'];

    public function __construct(private readonly OrganizationDirectory $organizations) {}

    public function requiredFor(User $user): bool
    {
        if ($user->isPlatformAdmin() || $user->organization_id === null) {
            return false;
        }

        return match ($this->organizations->twoFactorPolicy($user->organization_id)) {
            self::EVERYONE => true,
            self::ADMINS => array_intersect_key($user->permissionNames(), array_flip(self::ADMIN_PERMISSIONS)) !== [],
            default => false,
        };
    }

    /** Required by the policy but not set up yet: the user may only reach the setup screens. */
    public function setupRequired(User $user): bool
    {
        return ! $user->hasTwoFactorEnabled() && $this->requiredFor($user);
    }

    public function summary(string $organizationId): array
    {
        $active = fn (): Builder => User::query()->withoutGlobalScope('organization')
            ->where('organization_id', $organizationId)
            ->where('status', UserStatus::Active->value);

        $users = $active()->count();
        $enabled = $active()->whereNotNull('two_factor_confirmed_at')->count();

        $requiredMissing = match ($this->organizations->twoFactorPolicy($organizationId)) {
            self::EVERYONE => $users - $enabled,
            self::ADMINS => $active()->whereNull('two_factor_confirmed_at')
                ->whereHas('roles.permissions', fn (Builder $q) => $q->whereIn('name', self::ADMIN_PERMISSIONS))
                ->count(),
            default => 0,
        };

        return ['users' => $users, 'enabled' => $enabled, 'required_missing' => $requiredMissing];
    }
}
