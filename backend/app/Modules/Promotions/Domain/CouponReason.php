<?php

namespace App\Modules\Promotions\Domain;

/**
 * Why a coupon does not take effect. All but `better_offer` reject the code when it is
 * applied (422 COUPON_INVALID with `details.reason`); a coupon already on the cart that
 * becomes invalid stays there, ignored, with its reason.
 */
enum CouponReason: string
{
    /** Unknown code, or the code or its promotion is switched off (one generic answer). */
    case NotFound = 'not_found';
    case NotStarted = 'not_started';
    case Expired = 'expired';
    case UsageLimitReached = 'usage_limit_reached';
    case CustomerLimitReached = 'customer_limit_reached';
    case MinSubtotal = 'min_subtotal';
    case NotApplicable = 'not_applicable';
    /** Valid, but an automatic promotion gives more: the coupon stays on the cart, unused. */
    case BetterOffer = 'better_offer';

    public function message(?string $minSubtotal = null, ?string $currency = null): string
    {
        return match ($this) {
            self::NotFound => 'This coupon code is not valid.',
            self::NotStarted => 'This coupon is not valid yet.',
            self::Expired => 'This coupon has expired.',
            self::UsageLimitReached => 'This coupon has already been used up.',
            self::CustomerLimitReached => 'You have already used this coupon.',
            self::MinSubtotal => $minSubtotal === null
                ? 'Your cart does not reach the minimum amount for this coupon.'
                : "Add products worth at least {$minSubtotal}".($currency === null ? '' : " {$currency}").' to use this coupon.',
            self::NotApplicable => 'This coupon does not apply to the products in your cart.',
            self::BetterOffer => 'A better offer is already applied.',
        };
    }

    /**
     * Whether applying a code with this outcome is refused.
     */
    public function rejects(): bool
    {
        return $this !== self::BetterOffer;
    }
}
