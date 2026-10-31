<?php

namespace App\Modules\Promotions\Domain;

use App\Modules\Shared\Domain\ValueObjects\Money;

/**
 * What the engine decided: the product discount and promotion of every line, the one order
 * promotion, the free-delivery promotion and what became of the coupon.
 */
final readonly class EngineResult
{
    /**
     * @param  array<int|string, Money>  $lineDiscounts  product-level discount per line key (zero when none)
     * @param  array<int|string, ?Offer>  $linePromotions  the product promotion applied to each line
     * @param  list<array{offer: Offer, amount: Money}>  $productPromotions  in order of first use
     * @param  ?array{offer: Offer, amount: Money}  $orderPromotion
     */
    public function __construct(
        public Money $subtotal,
        public array $lineDiscounts,
        public array $linePromotions,
        public array $productPromotions,
        public ?array $orderPromotion,
        public ?Offer $freeShipping,
        public ?Offer $coupon,
        public bool $couponApplied,
        public ?CouponReason $couponReason,
    ) {}

    public function productDiscountTotal(): Money
    {
        return array_reduce($this->lineDiscounts, fn (Money $sum, Money $m) => $sum->plus($m), Money::zero($this->subtotal->currency));
    }

    public function orderDiscount(): Money
    {
        return $this->orderPromotion['amount'] ?? Money::zero($this->subtotal->currency);
    }
}
