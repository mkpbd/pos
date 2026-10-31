<?php

namespace App\Modules\Promotions\Domain;

use App\Modules\Shared\Domain\ValueObjects\Money;
use DateTimeInterface;

/**
 * The promotion rules (E8b), pure and deterministic — no database, no clock:
 *
 * 1. Product level. Every line gets at most one product promotion (scope products,
 *    categories or brands): among the live automatic ones and the coupon's, the one giving
 *    that line the largest discount; ties → earliest end, then smallest id. Percent = line
 *    amount × %; fixed = value × quantity, never more than the line amount. A promotion's
 *    min_subtotal is compared with the subtotal of all the lines it matches (before
 *    discounts). max_discount caps a promotion's total over its lines; the cap is shared
 *    out in proportion to the uncapped amounts (Money::allocate).
 * 2. Order level. The single best percent/fixed order promotion (live automatic ones and
 *    the coupon's) applies to the subtotal after product discounts; its min_subtotal is
 *    compared with the subtotal before any discount; percent is capped by max_discount.
 * 3. Free delivery. Any eligible free-shipping promotion (min_subtotal on the subtotal
 *    before discounts); an automatic one is preferred over the coupon's.
 * 4. The coupon. A coupon that is valid but not used anywhere because an automatic
 *    promotion gives more stays on the cart with reason `better_offer`.
 *
 * Tax is not the engine's business: the caller feeds the line discounts and the order
 * discount into SaleCalculator, which computes tax after discounts.
 */
final class PromotionEngine
{
    /**
     * @param  list<LineInput>  $lines  counted lines (keys unique)
     * @param  list<Offer>  $automatic  automatic promotions (non-live ones are ignored)
     * @param  ?Offer  $coupon  the promotion of the cart's coupon, when the code was found
     * @param  ?CouponReason  $couponBlocked  not_found (unknown code), usage_limit_reached or customer_limit_reached
     * @param  bool  $hasCoupon  whether the cart carries a coupon code at all
     */
    public static function apply(
        array $lines,
        array $automatic,
        ?Offer $coupon,
        ?CouponReason $couponBlocked,
        DateTimeInterface $now,
        string $currency,
        bool $hasCoupon = false,
    ): EngineResult {
        $zero = Money::zero($currency);
        $subtotals = [];
        $subtotal = $zero;
        foreach ($lines as $line) {
            $subtotals[$line->key] = Money::ofProduct($line->quantity, $line->unitPrice, $currency);
            $subtotal = $subtotal->plus($subtotals[$line->key]);
        }

        // The coupon: unknown codes, schedule, then the usage limits found by the caller.
        $couponReason = null;
        if ($coupon === null) {
            $couponReason = $hasCoupon || $couponBlocked !== null ? CouponReason::NotFound : null;
        } elseif ($couponBlocked === CouponReason::NotFound) {
            $couponReason = CouponReason::NotFound;
        } elseif ($coupon->startsAt !== null && $coupon->startsAt > $now) {
            $couponReason = CouponReason::NotStarted;
        } elseif ($coupon->endsAt !== null && $now >= $coupon->endsAt) {
            $couponReason = CouponReason::Expired;
        } elseif ($couponBlocked !== null) {
            $couponReason = $couponBlocked;
        }

        $candidates = array_values(array_filter($automatic, fn (Offer $o) => ! $o->isCoupon && $o->isLive($now)));
        if ($coupon !== null && $couponReason === null) {
            $candidates[] = $coupon;
        }
        $isCoupon = fn (Offer $o) => $coupon !== null && $o === $coupon;

        // 1. Product level.
        /** @var array<string, array<int|string, Money>> $potential uncapped discount per offer and line */
        $potential = [];
        $capped = [];
        $offers = [];
        foreach ($candidates as $offer) {
            if (! $offer->scope->isProductLevel() || $offer->type === PromotionType::FreeShipping) {
                continue;
            }
            $matching = array_values(array_filter($lines, fn (LineInput $l) => $offer->matches($l)));
            if ($matching === []) {
                $couponReason = $isCoupon($offer) ? CouponReason::NotApplicable : $couponReason;

                continue;
            }
            $base = array_reduce($matching, fn (Money $sum, LineInput $l) => $sum->plus($subtotals[$l->key]), $zero);
            if ($offer->minSubtotal !== null && $base->lessThan(Money::of($offer->minSubtotal, $currency))) {
                $couponReason = $isCoupon($offer) ? CouponReason::MinSubtotal : $couponReason;

                continue;
            }

            $amounts = [];
            foreach ($matching as $line) {
                $amounts[$line->key] = self::lineDiscount($offer, $line, $subtotals[$line->key]);
            }
            if (self::sum($amounts, $zero)->isZero()) {
                $couponReason = $isCoupon($offer) ? CouponReason::NotApplicable : $couponReason;

                continue;
            }
            $potential[$offer->id] = $amounts;
            $capped[$offer->id] = self::cap($amounts, $offer, $zero);
            $offers[$offer->id] = $offer;
        }

        /** @var array<int|string, ?Offer> $chosen */
        $chosen = [];
        foreach ($lines as $line) {
            $best = null;
            foreach ($offers as $id => $offer) {
                $amount = $capped[$id][$line->key] ?? null;
                if ($amount === null || $amount->isZero()) {
                    continue;
                }
                if ($best === null) {
                    $best = $offer;

                    continue;
                }
                $cmp = $amount->compareTo($capped[$best->id][$line->key]);
                if ($cmp > 0 || ($cmp === 0 && $offer->tieBreak($best) < 0)) {
                    $best = $offer;
                }
            }
            $chosen[$line->key] = $best;
        }

        // The cap is re-shared over the lines that actually use each promotion.
        $lineDiscounts = array_fill_keys(array_map(fn (LineInput $l) => $l->key, $lines), $zero);
        $productPromotions = [];
        foreach ($offers as $id => $offer) {
            $own = [];
            foreach ($chosen as $key => $picked) {
                if ($picked !== null && $picked->id === $id) {
                    $own[$key] = $potential[$id][$key];
                }
            }
            if ($own === []) {
                continue;
            }
            foreach (self::cap($own, $offer, $zero) as $key => $amount) {
                $lineDiscounts[$key] = $amount;
            }
        }
        foreach ($lines as $line) {
            $picked = $chosen[$line->key];
            if ($picked === null) {
                continue;
            }
            $found = false;
            foreach ($productPromotions as $i => $entry) {
                if ($entry['offer']->id === $picked->id) {
                    $productPromotions[$i]['amount'] = $entry['amount']->plus($lineDiscounts[$line->key]);
                    $found = true;
                }
            }
            if (! $found) {
                $productPromotions[] = ['offer' => $picked, 'amount' => $lineDiscounts[$line->key]];
            }
        }
        $afterProducts = $subtotal->minus(self::sum($lineDiscounts, $zero));

        // 2. Order level.
        $orderPromotion = null;
        foreach ($candidates as $offer) {
            if ($offer->scope !== PromotionScope::Order || $offer->type === PromotionType::FreeShipping) {
                continue;
            }
            if ($offer->minSubtotal !== null && $subtotal->lessThan(Money::of($offer->minSubtotal, $currency))) {
                $couponReason = $isCoupon($offer) ? CouponReason::MinSubtotal : $couponReason;

                continue;
            }
            $amount = self::orderDiscount($offer, $afterProducts, $currency);
            if ($amount->isZero()) {
                $couponReason = $isCoupon($offer) ? CouponReason::NotApplicable : $couponReason;

                continue;
            }
            if ($orderPromotion === null
                || $amount->greaterThan($orderPromotion['amount'])
                || ($amount->equals($orderPromotion['amount']) && $offer->tieBreak($orderPromotion['offer']) < 0)) {
                $orderPromotion = ['offer' => $offer, 'amount' => $amount];
            }
        }

        // 3. Free delivery.
        $freeShipping = null;
        foreach ($candidates as $offer) {
            if ($offer->type !== PromotionType::FreeShipping || $offer->scope !== PromotionScope::Order) {
                continue;
            }
            if ($lines === []) {
                $couponReason = $isCoupon($offer) ? CouponReason::NotApplicable : $couponReason;

                continue;
            }
            if ($offer->minSubtotal !== null && $subtotal->lessThan(Money::of($offer->minSubtotal, $currency))) {
                $couponReason = $isCoupon($offer) ? CouponReason::MinSubtotal : $couponReason;

                continue;
            }
            if ($freeShipping === null
                || ($freeShipping->isCoupon && ! $offer->isCoupon)
                || ($freeShipping->isCoupon === $offer->isCoupon && $offer->tieBreak($freeShipping) < 0)) {
                $freeShipping = $offer;
            }
        }

        // 4. The coupon's outcome.
        $applied = false;
        if ($coupon !== null && $couponReason === null) {
            $applied = in_array($coupon, $chosen, true)
                || ($orderPromotion !== null && $orderPromotion['offer'] === $coupon)
                || $freeShipping === $coupon;
            $couponReason = $applied ? null : CouponReason::BetterOffer;
        }

        return new EngineResult(
            subtotal: $subtotal,
            lineDiscounts: $lineDiscounts,
            linePromotions: $chosen,
            productPromotions: $productPromotions,
            orderPromotion: $orderPromotion,
            freeShipping: $freeShipping,
            coupon: $coupon,
            couponApplied: $applied,
            couponReason: $couponReason,
        );
    }

    /**
     * Percent of the line amount, or the fixed value per unit capped at the line amount.
     */
    public static function lineDiscount(Offer $offer, LineInput $line, Money $lineAmount): Money
    {
        if ($offer->type === PromotionType::Percent) {
            return $lineAmount->percent($offer->value);
        }
        $amount = Money::ofProduct($line->quantity, $offer->value, $lineAmount->currency);

        return $amount->greaterThan($lineAmount) ? $lineAmount : $amount;
    }

    /**
     * Percent of what is left after product discounts (capped by max_discount), or the
     * fixed value, never more than what is left.
     */
    public static function orderDiscount(Offer $offer, Money $base, string $currency): Money
    {
        if ($base->isZero() || $base->isNegative()) {
            return Money::zero($currency);
        }
        $amount = $offer->type === PromotionType::Percent ? $base->percent($offer->value) : Money::of($offer->value, $currency);
        if ($offer->maxDiscount !== null && $amount->greaterThan($max = Money::of($offer->maxDiscount, $currency))) {
            $amount = $max;
        }

        return $amount->greaterThan($base) ? $base : $amount;
    }

    /**
     * Applies max_discount to a promotion's line amounts: when they add up to more, the cap
     * is shared out in proportion to them.
     *
     * @param  array<int|string, Money>  $amounts
     * @return array<int|string, Money>
     */
    private static function cap(array $amounts, Offer $offer, Money $zero): array
    {
        $total = self::sum($amounts, $zero);
        if ($offer->maxDiscount === null || $total->isZero()) {
            return $amounts;
        }
        $max = Money::of($offer->maxDiscount, $zero->currency);
        if (! $total->greaterThan($max)) {
            return $amounts;
        }

        $shares = $max->allocate(array_values(array_map(fn (Money $m) => $m->amount(), $amounts)));

        return array_combine(array_keys($amounts), $shares);
    }

    /**
     * @param  array<int|string, Money>  $amounts
     */
    private static function sum(array $amounts, Money $zero): Money
    {
        return array_reduce($amounts, fn (Money $sum, Money $m) => $sum->plus($m), $zero);
    }
}
