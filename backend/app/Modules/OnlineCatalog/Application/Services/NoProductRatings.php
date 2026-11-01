<?php

namespace App\Modules\OnlineCatalog\Application\Services;

use App\Modules\OnlineCatalog\Application\Contracts\ProductRatings;

/**
 * Default while no reviews module is installed.
 */
final class NoProductRatings implements ProductRatings
{
    public function summary(string $productId): ?array
    {
        return null;
    }

    public function summaries(array $productIds): array
    {
        return [];
    }
}
