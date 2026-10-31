<?php

namespace App\Modules\Users\Application\Contracts;

use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Notifications\RoutesNotifications;
use Illuminate\Support\Collection;

/**
 * Finds people to notify or to name on documents, without other modules querying
 * users, roles or memberships.
 */
interface UserDirectory
{
    /**
     * Active users of the organization holding the permission who may work in the branch.
     *
     * @return Collection<int, Authenticatable&RoutesNotifications>
     */
    public function withPermissionInBranch(string $organizationId, string $permission, string $branchId): Collection;

    /**
     * Display names keyed by user id (users of other organizations are left out).
     *
     * @param  list<string>  $userIds
     * @return array<string, string>
     */
    public function names(string $organizationId, array $userIds): array;
}
