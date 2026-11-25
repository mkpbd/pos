<?php

namespace App\Modules\Pos\Application\Contracts;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * POS1a: manager approvals given at the till (`POST /pos/approvals`), for the Sales cart pricing
 * and checkout. An approval belongs to the organization in context and to the cashier who asked
 * for it, is valid for 10 minutes and is used by one sale.
 *
 * - `price_override` is bound to `details.variant_id` (any price the cashier then sends);
 * - `discount` covers the cart's manual item and invoice discounts.
 */
interface TillApprovals
{
    public const PRICE_OVERRIDE = 'price_override';

    public const DISCOUNT = 'discount';

    /**
     * Checks an approval for this requester and action. For `price_override` pass
     * `['variant_id' => …]`; an optional `store_id` must match the store it was given at.
     *
     * @param  array<string, mixed>  $details
     * @return array{id: string, approver_id: string, approver_name: string}
     *
     * @throws BusinessRuleViolation APPROVAL_INVALID — unknown, expired, used, another user's, action or variant
     */
    public function check(string $approvalId, string $requesterId, string $action, array $details): array;

    /**
     * Marks the approval used by the sale — inside the checkout transaction, with the row locked.
     * Consuming it again for the same sale is a no-op (one approval may cover several lines of
     * the same variant).
     *
     * @throws BusinessRuleViolation APPROVAL_INVALID — unknown, expired or used by another sale
     */
    public function consume(string $approvalId, string $saleId): void;
}
