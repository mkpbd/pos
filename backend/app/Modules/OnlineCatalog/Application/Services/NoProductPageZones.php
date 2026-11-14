<?php

namespace App\Modules\OnlineCatalog\Application\Services;

use App\Modules\OnlineCatalog\Application\Contracts\ProductPageZones;

/**
 * P1b: without the store builder, product pages have no builder zones.
 */
final class NoProductPageZones implements ProductPageZones
{
    public function forProduct(string $productId, array $categoryIds, bool $draft): array
    {
        return array_fill_keys(self::ZONES, null);
    }
}
