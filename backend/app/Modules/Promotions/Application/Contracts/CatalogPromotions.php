<?php

namespace App\Modules\Promotions\Application\Contracts;

/**
 * Promotions the storefront shows on products: live automatic product-scope promotions
 * (coupon promotions never show). The display object is
 * `{id, name, type, value, ends_at, show_countdown, price}` where `price` is the promotional
 * unit price (one unit, the same rule as the cart).
 *
 * Implementations cache the live promotions for their lifetime: resolve one per request.
 */
interface CatalogPromotions
{
    /**
     * @return ?array{id: string, name: string, type: string, value: string, ends_at: ?string, show_countdown: bool, price: string}
     */
    public function bestFor(string $productId, ?string $brandId, ?string $categoryId, string $unitPrice): ?array;

    /**
     * Live automatic countdown promotions ("flash sales"), or just $promotionId when given and
     * live, with their targets (categories include sub-categories), ending first first.
     *
     * @return list<array{id: string, ends_at: string, product_ids: list<string>, category_ids: list<string>, brand_ids: list<string>}>
     */
    public function countdownPromotions(?string $promotionId): array;

    /**
     * Whether the id is a countdown promotion of the organization (any state), for section validation.
     */
    public function isCountdownPromotion(string $promotionId): bool;
}
