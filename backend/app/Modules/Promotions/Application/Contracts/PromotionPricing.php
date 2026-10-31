<?php

namespace App\Modules\Promotions\Application\Contracts;

use App\Modules\Promotions\Application\DTOs\PromotionQuote;

/**
 * Prices the promotions of a cart or order (ADR-005: one pricing path). The caller passes
 * the counted lines with what the rules need and feeds the result into SaleCalculator.
 * Live automatic promotions of the organization in context apply; the coupon (if any) is
 * checked: unknown/off, schedule, total and per-customer usage limits (customer by account
 * → customer id, else guests by lower-cased e-mail when known), minimum subtotal, matching
 * lines. Promotions whose usage limits are reached are left out.
 */
interface PromotionPricing
{
    /**
     * @param  list<array{key: int|string, product_id: string, brand_id: ?string, category_id: ?string, quantity: string, unit_price: string}>  $lines
     */
    public function price(array $lines, ?string $couponCode, ?string $customerId, ?string $email, string $currency): PromotionQuote;
}
