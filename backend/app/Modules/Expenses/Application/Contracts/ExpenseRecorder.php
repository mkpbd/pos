<?php

namespace App\Modules\Expenses\Application\Contracts;

use App\Modules\Payments\Domain\PaymentMethod;

/**
 * What other modules may ask the Expenses module (E10a): record an expense that another
 * document caused, inside the caller's transaction — e.g. the courier fee deducted from a
 * cash-on-delivery remittance. The money moves through PaymentLedger::recordSystem (no
 * register drawer), so the method must not be cash.
 */
interface ExpenseRecorder
{
    /**
     * Records an expense in the named category of the current organization (created when
     * missing; matched case-insensitively). Numbered `EXP-…` like any expense.
     *
     * SC3: `on_account: true` books an expense that is owed to a supplier rather than paid
     * (landed cost on stock already sold — the payable sits on the supplier's account and is
     * settled by a supplier payment). No payments-ledger entry is written, `method` is the
     * expected way of settling it, and the entry cannot be voided on its own.
     *
     * @param  array{branch_id: string, category: string, amount: string, method: PaymentMethod, occurred_on: string, reference?: ?string, party?: ?string, notes?: ?string, on_account?: bool}  $data
     * @param  ?string  $actorId  the staff user (users.id), null for the system
     * @return array{id: string, number: string}
     */
    public function recordSystemExpense(array $data, ?string $actorId): array;
}
