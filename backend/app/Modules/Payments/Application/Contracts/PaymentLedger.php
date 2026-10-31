<?php

namespace App\Modules\Payments\Application\Contracts;

use App\Modules\Payments\Domain\LedgerEntry;
use App\Modules\Payments\Domain\PaymentSource;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * The organization-wide payments ledger and the register drawers behind it. Other modules
 * (Sales, Expenses) call it inside their own transaction, so a document and the money it
 * moved commit or roll back together.
 */
interface PaymentLedger
{
    /**
     * The actor's open register session in the branch, locked until the transaction ends.
     *
     * @return array{id: string, number: string, cash_register_id: string}
     *
     * @throws BusinessRuleViolation CASH_SESSION_REQUIRED
     */
    public function requireSession(TenantUser $actor, string $branchId): array;

    /**
     * Appends the entries. Cash needs the actor's open session in the branch (the drawer it
     * goes into or comes out of) and cannot take the drawer below zero; other methods are
     * linked to that session when one is open. Entries are immutable.
     *
     * @param  list<LedgerEntry>  $entries
     *
     * @throws BusinessRuleViolation CASH_SESSION_REQUIRED, INSUFFICIENT_CASH
     */
    public function record(TenantUser $actor, string $branchId, array $entries, PaymentSource $source): void;
}
