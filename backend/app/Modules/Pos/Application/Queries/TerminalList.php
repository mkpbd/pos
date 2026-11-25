<?php

namespace App\Modules\Pos\Application\Queries;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Pos\Infrastructure\Models\PosTerminal;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * POS1a: the tills of the organization in the branches the user may work in (active first,
 * then by name), shaped for the API.
 */
class TerminalList
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly BranchDirectory $branches,
        private readonly UserDirectory $users,
    ) {}

    /**
     * @return list<array<string, mixed>>
     */
    public function forUser(TenantUser $user, ?string $deviceHash): array
    {
        $terminals = PosTerminal::query()
            ->orderByRaw('revoked_at IS NOT NULL')
            ->orderBy('name')
            ->orderBy('created_at')
            ->get();

        return $this->present($terminals, $user, $deviceHash);
    }

    /**
     * A till of the organization in a branch the user may work in, or null.
     */
    public function find(TenantUser $user, string $id): ?PosTerminal
    {
        if (! Str::isUuid($id)) {
            return null;
        }

        $terminal = PosTerminal::query()->find($id);

        return $terminal !== null && $this->present(collect([$terminal]), $user, null) !== [] ? $terminal : null;
    }

    /**
     * @param  Collection<int, PosTerminal>  $terminals
     * @return list<array<string, mixed>>
     */
    public function present(Collection $terminals, TenantUser $user, ?string $deviceHash): array
    {
        if ($terminals->isEmpty()) {
            return [];
        }

        $organizationId = $this->tenant->requireOrganization();
        $stores = $this->branches->storeSummaries($organizationId, $terminals->pluck('store_id')->unique()->values()->all());
        $names = $this->users->names($organizationId, $terminals->pluck('created_by')->filter()->unique()->values()->all());

        return $terminals
            ->filter(fn (PosTerminal $t) => isset($stores[$t->store_id]) && $user->canAccessBranch($stores[$t->store_id]['branch_id']))
            ->map(fn (PosTerminal $t) => [
                'id' => $t->id,
                'name' => $t->name,
                'store' => ['id' => $t->store_id, 'name' => $stores[$t->store_id]['name']],
                'created_by' => $t->created_by !== null && isset($names[$t->created_by])
                    ? ['id' => $t->created_by, 'name' => $names[$t->created_by]]
                    : null,
                'created_at' => $t->created_at->toIso8601String(),
                'last_used_at' => $t->last_used_at?->toIso8601String(),
                'revoked_at' => $t->revoked_at?->toIso8601String(),
                'is_this_device' => $deviceHash !== null && hash_equals($t->token_hash, $deviceHash),
            ])
            ->values()
            ->all();
    }
}
