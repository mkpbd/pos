<?php

namespace App\Modules\Promotions\Application\Contracts;

/**
 * Redeeming promotions when an order is placed. Call both inside the placement transaction:
 * lock, price again (so usage limits are counted under the lock), then record. Releasing them
 * when the order is cancelled (Q1).
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
     * P2a: `$email` is null for landing page orders placed without one. BD1a: `$phone` is the
     * contact mobile number (01XXXXXXXXX), counted for per-customer limits too.
     *
     * @param  list<array{promotion_id: string, coupon_id: ?string, kind: string, amount: string}>  $redemptions
     */
    public function record(string $orderId, string $orderNumber, ?string $customerId, ?string $customerAccountId, ?string $email, array $redemptions, ?string $phone = null): void;

    /**
     * Q1: gives a cancelled order's promotions back, inside the cancelling transaction: its
     * redemptions are marked released (they stop counting towards usage limits, overall and
     * per customer) and each coupon's use is uncounted. Idempotent — already released
     * redemptions are skipped; returns what was released now (empty when nothing was).
     *
     * @return list<array{promotion_id: string, coupon_id: ?string, kind: string, amount: string}>
     */
    public function release(string $orderId): array;

    /**
     * POS1a: the till variant of {@see self::record()} for a POS sale (lock first, inside the
     * sale's transaction). Per-customer limits count the sale's customer id and mobile number.
     *
     * @param  list<array{promotion_id: string, coupon_id: ?string, kind: string, amount: string}>  $redemptions
     */
    public function recordForSale(string $saleId, string $saleNumber, ?string $customerId, ?string $phone, array $redemptions): void;

    /**
     * POS1a: gives a cancelled sale's promotions back, like {@see self::release()} for orders.
     *
     * @return list<array{promotion_id: string, coupon_id: ?string, kind: string, amount: string}>
     */
    public function releaseSale(string $saleId): array;
}
