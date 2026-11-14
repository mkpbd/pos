<?php

namespace App\Modules\OnlineCatalog\Application\Contracts;

/**
 * P1b: the store builder's content zones of a product page, resolved for one product — the
 * most specific version wins: the product's own, else its category's (nearest first, up the
 * tree), else the all-products one. Declared here and implemented by the Storefront module
 * (the builder), so the online catalog does not depend on it; the default answers no zones.
 */
interface ProductPageZones
{
    /** The product page's zones, top to bottom: under the price, after the details, at the very end. */
    public const ZONES = ['product.below_price', 'product.after', 'product.bottom'];

    /**
     * The render payload of each zone for this product (null = nothing to show), keyed by ZONES.
     * `$draft`: a staff draft preview — every existing version counts, with its draft.
     *
     * @param  list<string>  $categoryIds  the product's category and its ancestors, nearest first
     * @return array<string, array<string, mixed>|null>
     */
    public function forProduct(string $productId, array $categoryIds, bool $draft): array;
}
