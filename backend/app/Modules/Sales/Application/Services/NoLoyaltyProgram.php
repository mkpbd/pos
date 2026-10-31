<?php

namespace App\Modules\Sales\Application\Services;

use App\Modules\Sales\Application\Contracts\LoyaltyProgram;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * Default when no loyalty module is installed: nothing is earned, nothing can be redeemed.
 */
class NoLoyaltyProgram implements LoyaltyProgram
{
    public function redeem(string $customerId, string $amount, string $saleId, string $saleNumber): void
    {
        throw new BusinessRuleViolation('LOYALTY_NOT_AVAILABLE', 'Loyalty points cannot be redeemed.');
    }

    public function award(string $customerId, string $basis, string $saleId, string $saleNumber): void {}

    public function reverseSale(string $customerId, string $saleId, string $saleNumber): void {}

    public function reverseReturn(string $customerId, string $saleId, string $returnId, string $returnNumber, string $returnedShare, string $refundedAmount): void {}
}
