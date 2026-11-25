<?php

namespace App\Modules\Pos\Application\Actions;

use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Pos\Application\Services\TerminalCookie;
use App\Modules\Pos\Infrastructure\Models\PosTerminal;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * POS1a: sets up this device as a till of a store the user may work in. A till this device
 * already was (in the same organization) is revoked: a device is one till at a time.
 */
class SetUpTerminal
{
    public function __construct(
        private readonly StoreAccess $storeAccess,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  ?string  $currentTokenHash  the device's current till token hash, if any
     * @return array{terminal: PosTerminal, token: string}
     *
     * @throws ValidationException `store_id` of another organization / branch or inactive
     */
    public function __invoke(TenantUser $user, string $storeId, string $name, ?string $currentTokenHash): array
    {
        $store = $this->storeAccess->require($user, $storeId);
        $token = TerminalCookie::newToken();

        $terminal = DB::transaction(function () use ($store, $name, $token, $currentTokenHash, $user) {
            if ($currentTokenHash !== null) {
                $previous = PosTerminal::query()->where('token_hash', $currentTokenHash)->whereNull('revoked_at')->lockForUpdate()->first();
                if ($previous !== null) {
                    $previous->forceFill(['revoked_at' => now()])->save();
                    $this->audit->record('pos.terminal_revoked', $previous, context: ['name' => $previous->name, 'replaced' => true]);
                }
            }

            $terminal = PosTerminal::query()->create([
                'store_id' => $store['id'],
                'name' => $name,
                'token_hash' => TerminalCookie::hash($token),
                'created_by' => (string) $user->getAuthIdentifier(),
            ]);
            $this->audit->record('pos.terminal_created', $terminal, new: ['name' => $name, 'store_id' => $store['id']]);

            return $terminal;
        });

        return ['terminal' => $terminal, 'token' => $token];
    }
}
