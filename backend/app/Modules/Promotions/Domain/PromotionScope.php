<?php

namespace App\Modules\Promotions\Domain;

/**
 * What a promotion applies to: the whole order, or the lines of chosen products, of
 * products in chosen categories (sub-categories included) or of chosen brands.
 */
enum PromotionScope: string
{
    case Order = 'order';
    case Products = 'products';
    case Categories = 'categories';
    case Brands = 'brands';

    public function isProductLevel(): bool
    {
        return $this !== self::Order;
    }

    /**
     * The kind of record the targets of this scope are, or null for the order scope.
     */
    public function targetType(): ?string
    {
        return match ($this) {
            self::Order => null,
            self::Products => 'product',
            self::Categories => 'category',
            self::Brands => 'brand',
        };
    }
}
