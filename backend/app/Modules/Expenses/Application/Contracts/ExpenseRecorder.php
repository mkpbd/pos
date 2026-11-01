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
     * @param  array{branch_id: string, category: string, amount: string, method: PaymentMethod, occurred_on: string, reference?: ?string, party?: ?string, notes?: ?string}  $data
     * @param  ?string  $actorId  the staff user (users.id), null for the system
     * @return array{id: string, number: string}
     */
    public function recordSystemExpense(array $data, ?string $actorId): array;
}
