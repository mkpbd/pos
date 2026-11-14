<?php

namespace App\Modules\Products\Application\Services;

use App\Modules\Products\Application\Contracts\VariantWebData;

/**
 * Used when the online catalog is not installed.
 */
class NoVariantWebData implements VariantWebData
{
    public function compareAtPrices(array $variantIds): array
    {
        return array_fill_keys($variantIds, null);
    }

    public function saveCompareAtPrices(array $prices): void {}

    public function openBackInStockRequests(array $variantIds): array
    {
        return array_fill_keys($variantIds, 0);
    }
}
