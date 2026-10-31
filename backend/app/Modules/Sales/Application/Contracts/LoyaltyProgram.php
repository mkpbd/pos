<?php

namespace App\Modules\Sales\Application\Contracts;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * What Sales needs from a loyalty program. Declared here and implemented by the Loyalty
 * module (which depends on Sales, not the other way round); without it the program is off.
 * Every method runs inside the caller's sale/return transaction.
 */
interface LoyaltyProgram
{
    /**
     * Spends points worth $amount (currency) of the customer on a sale.
     *
     * @throws BusinessRuleViolation LOYALTY_NOT_AVAILABLE, LOYALTY_AMOUNT_INVALID, INSUFFICIENT_POINTS
     */
    public function redeem(string $customerId, string $amount, string $saleId, string $saleNumber): void;

    /**
     * Earns points for a completed sale; $basis is the amount the points are earned on.
     */
    public function award(string $customerId, string $basis, string $saleId, string $saleNumber): void;

    /**
     * The sale was cancelled: takes back the points it earned and gives back the points it spent.
     */
    public function reverseSale(string $customerId, string $saleId, string $saleNumber): void;

    /**
     * A return against the sale was completed. $returnedShare is the part of the sale returned so
     * far (all completed returns, 0–1): that share of the earned points is taken back.
     * $refundedAmount is the value refunded as points (given back to the customer).
     */
    public function reverseReturn(string $customerId, string $saleId, string $returnId, string $returnNumber, string $returnedShare, string $refundedAmount): void;
}
