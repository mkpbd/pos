<?php

namespace App\Modules\Pos\Application\Actions;

use App\Modules\Pos\Infrastructure\Models\PosTerminal;
use App\Modules\Shared\Application\Contracts\AuditTrail;

/**
 * POS1a: a till is revoked (lost device, till taken out of use): its cookie no longer signs
 * anyone in. The row stays for the sign-in history.
 */
class RevokeTerminal
{
    public function __construct(private readonly AuditTrail $audit) {}

    public function __invoke(PosTerminal $terminal): void
    {
        if ($terminal->revoked_at !== null) {
            return;
        }

        $terminal->forceFill(['revoked_at' => now()])->save();
        $this->audit->record('pos.terminal_revoked', $terminal, context: ['name' => $terminal->name]);
    }
}
