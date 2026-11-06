<?php

namespace App\Modules\Purchasing\Domain\Procurement;

use App\Modules\Shared\Domain\ValueObjects\Decimal;
use InvalidArgumentException;

/**
 * Pure approval rules (SC2). Amounts are money strings (estimated or order totals incl. tax,
 * in the organization's base currency).
 *
 * - level(): ≤ auto limit → none; ≤ manager limit → manager; above → high (boundaries
 *   belong to the lower tier).
 * - withinPreApproval(): a purchase order created from an approved requisition (directly or
 *   through an RFQ award) is pre-approved while its total does not exceed the approved
 *   amount by more than 5 %.
 */
final class ApprovalPolicy
{
    public const PRE_APPROVAL_TOLERANCE_PERCENT = '5';

    public static function level(string $amount, string $autoApproveLimit, string $managerLimit): ApprovalLevel
    {
        if (Decimal::compare($autoApproveLimit, $managerLimit) > 0) {
            throw new InvalidArgumentException('The auto-approve limit cannot be above the manager limit.');
        }

        return match (true) {
            Decimal::compare($amount, $autoApproveLimit) <= 0 => ApprovalLevel::None,
            Decimal::compare($amount, $managerLimit) <= 0 => ApprovalLevel::Manager,
            default => ApprovalLevel::High,
        };
    }

    /** The highest total still covered by a pre-approved amount (approved × 1.05, 2 decimals). */
    public static function preApprovalCeiling(string $approvedAmount): string
    {
        return Decimal::mul($approvedAmount, Decimal::add('1', Decimal::div(self::PRE_APPROVAL_TOLERANCE_PERCENT, '100', 4), 4), 2);
    }

    public static function withinPreApproval(string $total, ?string $approvedAmount): bool
    {
        return $approvedAmount !== null && Decimal::compare($total, self::preApprovalCeiling($approvedAmount)) <= 0;
    }

    /**
     * The share of an approved line amount that covers part of its quantity
     * (line total × part / quantity, 2 decimals).
     */
    public static function share(string $lineTotal, string $part, string $quantity): string
    {
        if (Decimal::isZero($quantity)) {
            return '0.00';
        }

        return Decimal::round(Decimal::div(Decimal::mul($lineTotal, $part, 8), $quantity, 8), 2);
    }
}
