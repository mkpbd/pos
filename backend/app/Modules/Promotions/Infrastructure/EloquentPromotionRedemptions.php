<?php

namespace App\Modules\Promotions\Infrastructure;

use App\Modules\Promotions\Application\Contracts\PromotionRedemptions;
use App\Modules\Promotions\Infrastructure\Models\Coupon;
use App\Modules\Promotions\Infrastructure\Models\Promotion;
use App\Modules\Promotions\Infrastructure\Models\PromotionRedemption;
use Illuminate\Database\Eloquent\Builder;

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

    public function record(string $orderId, string $orderNumber, ?string $customerId, ?string $customerAccountId, string $email, array $redemptions): void
    {
        $now = now();
        $coupons = [];
        foreach ($redemptions as $redemption) {
            PromotionRedemption::query()->create([
                'promotion_id' => $redemption['promotion_id'],
                'coupon_id' => $redemption['coupon_id'],
                'order_id' => $orderId,
                'order_number' => $orderNumber,
                'customer_id' => $customerId,
                'customer_account_id' => $customerAccountId,
                'email' => mb_strtolower(trim($email)),
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
}
