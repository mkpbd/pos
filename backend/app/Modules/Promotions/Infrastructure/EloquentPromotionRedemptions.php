<?php

namespace App\Modules\Promotions\Infrastructure;

use App\Modules\Promotions\Application\Contracts\PromotionRedemptions;
use App\Modules\Promotions\Infrastructure\Models\Coupon;
use App\Modules\Promotions\Infrastructure\Models\Promotion;
use App\Modules\Promotions\Infrastructure\Models\PromotionRedemption;
use App\Modules\Shared\Application\Contracts\StorefrontContentVersion;
use App\Modules\Shared\Domain\BangladeshMobile;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

/**
 * Q1: release() marks a cancelled order's redemptions released and uncounts its coupons.
 */
class EloquentPromotionRedemptions implements PromotionRedemptions
{
    public function lock(array $promotionIds, ?string $couponId): bool
    {
        $locked = false;
        $ids = array_values(array_unique($promotionIds));
        sort($ids);
        if ($ids !== []) {
            // Only limited promotions need serializing; unlimited ones are never re-checked.
            $locked = Promotion::query()->whereIn('id', $ids)
                ->where(fn (Builder $q) => $q->whereNotNull('usage_limit')->orWhereNotNull('usage_limit_per_customer'))
                ->orderBy('id')->lockForUpdate()->pluck('id')->isNotEmpty();
        }
        if ($couponId !== null) {
            $locked = Coupon::query()->whereKey($couponId)->lockForUpdate()->pluck('id')->isNotEmpty() || $locked;
        }

        return $locked;
    }

    public function record(string $orderId, string $orderNumber, ?string $customerId, ?string $customerAccountId, ?string $email, array $redemptions, ?string $phone = null): void
    {
        $now = now();
        $coupons = [];
        $phone = $phone === null ? null : BangladeshMobile::normalize($phone);
        foreach ($redemptions as $redemption) {
            PromotionRedemption::query()->create([
                'promotion_id' => $redemption['promotion_id'],
                'coupon_id' => $redemption['coupon_id'],
                'order_id' => $orderId,
                'order_number' => $orderNumber,
                'customer_id' => $customerId,
                'customer_account_id' => $customerAccountId,
                'email' => $email === null || trim($email) === '' ? null : mb_strtolower(trim($email)),
                'phone' => $phone,
                'kind' => $redemption['kind'],
                'amount' => $redemption['amount'],
                'created_at' => $now,
            ]);
            if ($redemption['coupon_id'] !== null) {
                $coupons[$redemption['coupon_id']] = true;
            }
        }

        foreach (array_keys($coupons) as $couponId) {
            Coupon::query()->whereKey($couponId)->increment('used_count');
        }
    }

    public function release(string $orderId): array
    {
        /** @var Collection<int, PromotionRedemption> $rows */
        $rows = PromotionRedemption::query()->where('order_id', $orderId)->whereNull('released_at')
            ->orderBy('id')->lockForUpdate()->get();
        if ($rows->isEmpty()) {
            return [];
        }

        // Query-builder updates: the model guard (AppendOnly) refuses every update; the trigger
        // allows exactly this one (released_at NULL → a time).
        PromotionRedemption::query()->whereKey($rows->pluck('id')->all())->whereNull('released_at')->update(['released_at' => now()]);

        // record() counted each coupon once per order.
        $couponIds = $rows->pluck('coupon_id')->filter()->unique()->sort()->values()->all();
        foreach ($couponIds as $couponId) {
            Coupon::query()->whereKey($couponId)->where('used_count', '>', 0)->decrement('used_count');
        }

        // A used-up offer may be available again on the storefront.
        app(StorefrontContentVersion::class)->bump((string) $rows->first()->getAttribute('organization_id'));

        return $rows->map(fn (PromotionRedemption $r) => [
            'promotion_id' => $r->promotion_id,
            'coupon_id' => $r->coupon_id,
            'kind' => $r->kind,
            'amount' => (string) $r->amount,
        ])->values()->all();
    }
}
