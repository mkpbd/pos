<?php

namespace App\Modules\Promotions\Tests\Concerns;

use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Promotions\Application\Actions\SavePromotion;
use App\Modules\Promotions\Infrastructure\Models\Coupon;
use App\Modules\Promotions\Infrastructure\Models\Promotion;

/**
 * Promotions created through the real use case inside the tenant (no HTTP), for tests that
 * then browse the storefront. Use with InteractsWithTenancy.
 */
trait BuildsPromotions
{
    /**
     * @param  array<string, mixed>  $data  SavePromotion fields (defaults: automatic, active, order scope)
     */
    protected function makePromotion(Organization $organization, array $data): Promotion
    {
        return $this->inTenant($organization, fn () => app(SavePromotion::class)(new Promotion, $data + [
            'scope' => 'order',
            'trigger' => 'automatic',
            'is_active' => true,
        ]));
    }

    protected function makeCoupon(Organization $organization, Promotion $promotion, string $code, ?int $usageLimit = null): Coupon
    {
        return $this->inTenant($organization, fn () => Coupon::query()->create(['promotion_id' => $promotion->id, 'code' => $code, 'usage_limit' => $usageLimit]));
    }

    protected function productOf(string $variantId): string
    {
        return (string) ProductVariant::query()->withoutGlobalScopes()->whereKey($variantId)->value('product_id');
    }
}
