<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\OnlineCatalog\Application\Contracts\ProductPageZones;

/**
 * P1b: the store builder's answer to the online catalog's ProductPageZones — the product page
 * zones of one product, the most specific version of each (BuilderPages::productZones()).
 */
final class BuilderProductZones implements ProductPageZones
{
    public function __construct(private readonly BuilderPages $pages) {}

    public function forProduct(string $productId, array $categoryIds, bool $draft): array
    {
        return $this->pages->productZones(strtolower($productId), array_values(array_map('strtolower', $categoryIds)), $draft);
    }
}
