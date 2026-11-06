<?php

namespace App\Modules\Reports\Application\Support;

use App\Modules\Shared\Application\Contracts\TenantUser;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Choices for the `cashier_id` report parameter, so the filter works for roles that cannot
 * read the user list: users of the organization assigned to one of the branches the viewer
 * can report on, plus anyone who rang up a sale there (e.g. an administrator with access to
 * every branch). Read-only; names only.
 */
final class CashierOptions
{
    /**
     * @return list<array{value: string, label: string}>
     */
    public function for(TenantUser $user, string $organizationId): array
    {
        $branches = $user->accessibleBranchIds();
        $assigned = DB::table('branch_user')->select('user_id')
            ->when($branches !== null, fn (Builder $q) => $q->whereIn('branch_id', $branches));
        $sellers = DB::table('sales')->select('created_by')->where('organization_id', $organizationId)->whereNotNull('created_by')
            ->when($branches !== null, fn (Builder $q) => $q->whereIn('branch_id', $branches));

        return DB::table('users')
            ->where('organization_id', $organizationId)
            ->where(fn (Builder $q) => $q->whereIn('id', $assigned)->orWhereIn('id', $sellers))
            ->orderBy('name')->orderBy('id')
            ->get(['id', 'name'])
            ->map(fn ($u) => ['value' => (string) $u->id, 'label' => (string) $u->name])
            ->all();
    }
}
