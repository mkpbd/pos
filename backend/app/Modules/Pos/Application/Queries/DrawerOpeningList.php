<?php

namespace App\Modules\Pos\Application\Queries;

use App\Modules\Organizations\Application\Support\OrganizationDate;
use App\Modules\Pos\Infrastructure\Models\DrawerOpening;
use App\Modules\Pos\Infrastructure\Models\PosTerminal;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * POS1d: no-sale drawer openings of the branches the user may work in, newest first, shaped for
 * the API.
 */
class DrawerOpeningList
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly UserDirectory $users,
        private readonly OrganizationDate $date,
    ) {}

    /**
     * @param  array{branch_id?: string, register_session_id?: string, user_id?: string, from?: string, to?: string}  $filters  dates as Y-m-d (organization's days)
     * @return LengthAwarePaginator<int, DrawerOpening>
     */
    public function paginate(TenantUser $user, array $filters, int $perPage): LengthAwarePaginator
    {
        $timezone = $this->date->timezone();
        $day = fn (string $date) => Carbon::parse($date, $timezone)->startOfDay()->setTimezone(config('app.timezone'));
        $accessible = $user->accessibleBranchIds();

        return DrawerOpening::query()
            ->when($accessible !== null, fn ($q) => $q->whereIn('branch_id', $accessible))
            ->when($filters['branch_id'] ?? null, fn ($q, string $v) => $q->where('branch_id', $v))
            ->when($filters['register_session_id'] ?? null, fn ($q, string $v) => $q->where('register_session_id', $v))
            ->when($filters['user_id'] ?? null, fn ($q, string $v) => $q->where('user_id', $v))
            ->when($filters['from'] ?? null, fn ($q, string $v) => $q->where('opened_at', '>=', $day($v)))
            ->when($filters['to'] ?? null, fn ($q, string $v) => $q->where('opened_at', '<', $day($v)->addDay()))
            ->orderByDesc('opened_at')
            ->orderByDesc('id')
            ->paginate($perPage);
    }

    /**
     * @param  Collection<int, DrawerOpening>  $openings
     * @return callable(DrawerOpening): array<string, mixed>
     */
    public function presenter(Collection $openings): callable
    {
        $organizationId = $this->tenant->requireOrganization();
        $names = $this->users->names($organizationId, $openings->flatMap(fn (DrawerOpening $o) => [$o->user_id, $o->approved_by])->filter()->unique()->values()->all());
        $terminals = PosTerminal::query()->whereKey($openings->pluck('terminal_id')->filter()->unique()->values())->pluck('name', 'id');

        return fn (DrawerOpening $o) => [
            'id' => $o->id,
            'opened_at' => $o->opened_at->toIso8601String(),
            'reason' => $o->reason,
            'user' => ['id' => $o->user_id, 'name' => $names[$o->user_id] ?? null],
            'approved_by' => $o->approved_by === null ? null : ['id' => $o->approved_by, 'name' => $names[$o->approved_by] ?? null],
            'register_session' => $o->register_session_id === null ? null : ['id' => $o->register_session_id, 'number' => $o->register_session_number],
            'terminal' => $o->terminal_id === null ? null : ['id' => $o->terminal_id, 'name' => $terminals[$o->terminal_id] ?? null],
        ];
    }
}
