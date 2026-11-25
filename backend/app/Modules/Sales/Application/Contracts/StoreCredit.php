<?php

namespace App\Modules\Sales\Application\Contracts;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * POS1b: what Sales needs from customers' store credit (advances, refunds to credit), so a
 * sale can be paid with it and a return refunded to it. Declared here and implemented by the
 * StoredValue module (which depends on Sales, not the other way round). Every method runs
 * inside the caller's sale/return transaction and serialises on the customer.
 */
interface StoreCredit
{
    /**
     * The customer's store credit balance (currency scale, ≥ 0).
     */
    public function balance(string $customerId): string;

    /**
     * Pays $amount of a sale with the customer's store credit.
     *
     * @throws BusinessRuleViolation INSUFFICIENT_STORE_CREDIT (details.balance)
     */
    public function spend(string $customerId, string $amount, string $saleId, string $saleNumber): void;

    /**
     * The sale was cancelled: credits back what it spent. Idempotent.
     */
    public function reverseSale(string $saleId): void;

    /**
     * A return refunded $amount to the customer's store credit.
     */
    public function refund(string $customerId, string $amount, string $returnId, string $returnNumber): void;
}
