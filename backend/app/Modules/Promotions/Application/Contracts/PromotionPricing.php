<?php

namespace App\Modules\Promotions\Application\Contracts;

use App\Modules\Promotions\Application\DTOs\PromotionQuote;

/**
 * Prices the promotions of a cart or order (ADR-005: one pricing path). The caller passes
 * the counted lines with what the rules need and feeds the result into SaleCalculator.
 * Live automatic promotions of the organization in context apply; the coupon (if any) is
 * checked: unknown/off, schedule, total and per-customer usage limits (customer by account
 * → customer id, else guests by lower-cased e-mail when known; BD1a: or by the contact mobile
 * number), minimum subtotal, matching lines. Promotions whose usage limits are reached are left out.
 */
interface PromotionPricing
{
    /** POS1a: the online store (web carts and orders) — the default. */
    public const CHANNEL_ONLINE = 'online';

    /** POS1a: the till (POS sales); free-delivery promotions never apply there. */
    public const CHANNEL_TILL = 'till';

    /**
     * POS1a: only promotions (automatic ones and the coupon's) that apply on `$channel` are
     * used; a coupon of another channel is unknown (`not_found`). A line may carry
     * `promotable: false` (no product promotion for it: the seller changed its price or gave
     * it a discount) and `own_discount` (that discount, decimal string; it is taken off
     * before the order promotion is worked out).
     *
     * @param  list<array{key: int|string, product_id: string, brand_id: ?string, category_id: ?string, quantity: string, unit_price: string, promotable?: bool, own_discount?: string}>  $lines
     * @param  ?string  $phone  BD1a: the contact mobile number at checkout (per-customer limits)
     */
    public function price(array $lines, ?string $couponCode, ?string $customerId, ?string $email, string $currency, ?string $phone = null, string $channel = self::CHANNEL_ONLINE): PromotionQuote;
}
