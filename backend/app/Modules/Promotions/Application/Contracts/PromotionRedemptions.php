<?php

namespace App\Modules\Promotions\Application\Contracts;

/**
 * Redeeming promotions when an order is placed. Call both inside the placement transaction:
 * lock, price again (so usage limits are counted under the lock), then record.
 */
interface PromotionRedemptions
{
    /**
     * Locks (FOR UPDATE, sorted by id) the rows of the given promotions that carry a usage
     * limit, and the coupon. Returns whether anything was locked.
     *
     * @param  list<string>  $promotionIds
     */
    public function lock(array $promotionIds, ?string $couponId): bool;

    /**
     * Appends one redemption per promotion used and counts the coupon's use.
     *
     * P2a: `$email` is null for landing page orders placed without one.
     *
     * @param  list<array{promotion_id: string, coupon_id: ?string, kind: string, amount: string}>  $redemptions
     */
    public function record(string $orderId, string $orderNumber, ?string $customerId, ?string $customerAccountId, ?string $email, array $redemptions): void;
}
