<?php

namespace App\Modules\Users\Infrastructure\Directory;

use App\Modules\Users\Application\Contracts\UserDirectory;
use App\Modules\Users\Domain\Enums\UserStatus;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

class EloquentUserDirectory implements UserDirectory
{
    public function withPermissionInBranch(string $organizationId, string $permission, string $branchId): Collection
    {
        return User::query()->withoutGlobalScope('organization')
            ->where('organization_id', $organizationId)
            ->where('status', UserStatus::Active->value)
            ->whereHas('roles.permissions', fn (Builder $q) => $q->where('name', $permission))
            ->with('branchMemberships')
            ->get()
            ->filter(fn (User $user) => $user->canAccessBranch($branchId))
            ->values();
    }

    public function names(string $organizationId, array $userIds): array
    {
        if ($userIds === []) {
            return [];
        }

        return User::query()->withoutGlobalScope('organization')
            ->where('organization_id', $organizationId)
            ->whereKey(array_values(array_unique($userIds)))
            ->pluck('name', 'id')
            ->all();
    }
}
