<?php

namespace App\Modules\Pos\Application\Services;

use App\Modules\Pos\Application\Contracts\DrawerOpenings;
use App\Modules\Pos\Infrastructure\Models\DrawerOpening;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Support\Str;

/**
 * POS1d: no-sale drawer openings of the organization in context (the tenant scope of
 * DrawerOpening), for the register session documents.
 */
class EloquentDrawerOpenings implements DrawerOpenings
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly UserDirectory $users,
    ) {}

    public function countForSessions(array $sessionIds): array
    {
        $ids = array_values(array_unique(array_filter($sessionIds, fn ($id) => is_string($id) && Str::isUuid($id))));
        $counts = array_fill_keys($ids, 0);
        if ($ids === []) {
            return $counts;
        }

        DrawerOpening::query()
            ->whereIn('register_session_id', $ids)
            ->groupBy('register_session_id')
            ->selectRaw('register_session_id, COUNT(*) AS openings')
            ->toBase()
            ->get()
            ->each(function (object $row) use (&$counts) {
                $counts[$row->register_session_id] = (int) $row->openings;
            });

        return $counts;
    }

    public function forSession(string $sessionId): array
    {
        if (! Str::isUuid($sessionId)) {
            return [];
        }

        $openings = DrawerOpening::query()->where('register_session_id', $sessionId)->orderBy('opened_at')->orderBy('id')->get();
        if ($openings->isEmpty()) {
            return [];
        }
        $names = $this->users->names(
            $this->tenant->requireOrganization(),
            $openings->flatMap(fn (DrawerOpening $o) => [$o->user_id, $o->approved_by])->filter()->unique()->values()->all(),
        );

        return $openings->map(fn (DrawerOpening $o) => [
            'opened_at' => $o->opened_at->toIso8601String(),
            'reason' => $o->reason,
            'user_name' => $names[$o->user_id] ?? null,
            'approved_by_name' => $o->approved_by === null ? null : ($names[$o->approved_by] ?? null),
        ])->values()->all();
    }
}
