<?php

namespace App\Modules\Promotions\Application\Contracts;

/**
 * B4: promotions as the store builder shows them (countdown and discount elements), scoped to
 * the organization in the tenant context; another organization's ids are absent like unknown
 * ones. `state` is `active`, `scheduled`, `expired` or `inactive` (PromotionState); names are
 * in the request's language. Instants are ISO 8601, amounts decimal strings ("10.00").
 */
interface PromotionShowcase
{
    /**
     * Countdown promotions ("flash sales": automatic, with a countdown) among the ids, keyed by id.
     *
     * @param  list<string>  $ids
     * @return array<string, array{id: string, name: string, starts_at: ?string, ends_at: ?string, state: string}>
     */
    public function countdowns(array $ids): array;

    /**
     * Percent and fixed-amount promotions (automatic or coupon) among the ids, keyed by id.
     * `coupon_code` is the first usable code of a coupon promotion (active, not used up), else null.
     *
     * @param  list<string>  $ids
     * @return array<string, array{id: string, name: string, kind: string, value: string, coupon_code: ?string, min_subtotal: ?string, starts_at: ?string, ends_at: ?string, state: string}>
     */
    public function discounts(array $ids): array;

    /**
     * B8a: how much of a usage-limited promotion is taken — `{used, limit}` (redemptions,
     * capped at the limit) for the promotions among the ids that have a usage limit; others
     * are absent.
     *
     * @param  list<string>  $ids
     * @return array<string, array{used: int, limit: int}>
     */
    public function claimed(array $ids): array;

    /**
     * B8b: the id of the running (active) percent / fixed-amount coupon promotion with a usable
     * code that ends first (open-ended ones last, then the oldest), or null — for store builder
     * templates that show "a coupon" (the exit-offer popup).
     */
    public function runningCouponPromotion(): ?string;
}
