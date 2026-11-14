<?php

namespace App\Modules\Products\Application\Contracts;

/**
 * P1a: the online store's per-variant data the variant grid shows and edits (compare-at
 * prices, open back-in-stock requests), declared here and implemented by OnlineCatalog.
 * Without it (`NoVariantWebData`) there is none. Scoped to the current organization.
 */
interface VariantWebData
{
    /**
     * @param  list<string>  $variantIds
     * @return array<string, ?string> variant id => compare-at price ("140.00") or null
     */
    public function compareAtPrices(array $variantIds): array;

    /**
     * Sets (or with null clears) compare-at prices; other web data of the variants is kept.
     *
     * @param  array<string, ?string>  $prices  variant id => price
     */
    public function saveCompareAtPrices(array $prices): void;

    /**
     * @param  list<string>  $variantIds
     * @return array<string, int> variant id => number of open back-in-stock requests
     */
    public function openBackInStockRequests(array $variantIds): array;
}
