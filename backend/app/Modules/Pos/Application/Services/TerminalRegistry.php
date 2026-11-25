<?php

namespace App\Modules\Pos\Application\Services;

use App\Modules\Authentication\Application\Contracts\TillDevices;
use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Pos\Infrastructure\Models\PosTerminal;
use Illuminate\Http\Request;

/**
 * POS1a: finds the till of a request from its `pos_terminal` cookie (not revoked, store still
 * there) and notes when it was last used (at most once a minute). Implements the Authentication
 * module's TillDevices for the PIN sign-in.
 */
class TerminalRegistry implements TillDevices
{
    public function __construct(private readonly BranchDirectory $branches) {}

    /**
     * @return array{terminal: PosTerminal, store: array{id: string, code: string, name: string, branch_id: string, branch_name: string, is_active: bool, branch_is_active: bool}}|null
     */
    public function resolve(Request $request): ?array
    {
        $hash = TerminalCookie::tokenHash($request);
        if ($hash === null) {
            return null;
        }

        $terminal = PosTerminal::query()->withoutGlobalScope('organization')
            ->where('token_hash', $hash)
            ->whereNull('revoked_at')
            ->first();
        $store = $terminal !== null ? $this->branches->store($terminal->store_id, $terminal->organization_id) : null;
        if ($terminal === null || $store === null) {
            return null;
        }

        if ($terminal->last_used_at === null || $terminal->last_used_at->lt(now()->subMinute())) {
            $now = now();
            PosTerminal::query()->withoutGlobalScope('organization')->whereKey($terminal->id)->toBase()->update(['last_used_at' => $now]);
            $terminal->forceFill(['last_used_at' => $now])->syncOriginalAttributes(['last_used_at']);
        }

        return ['terminal' => $terminal, 'store' => $store];
    }

    public function fromRequest(Request $request): ?array
    {
        $resolved = $this->resolve($request);
        if ($resolved === null) {
            return null;
        }

        return [
            'id' => $resolved['terminal']->id,
            'organization_id' => $resolved['terminal']->organization_id,
            'name' => $resolved['terminal']->name,
            'store_id' => $resolved['store']['id'],
            'branch_id' => $resolved['store']['branch_id'],
        ];
    }

    public function deviceKey(Request $request): ?string
    {
        return TerminalCookie::tokenHash($request);
    }
}
