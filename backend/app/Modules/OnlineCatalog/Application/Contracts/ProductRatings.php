<?php

namespace App\Modules\OnlineCatalog\Application\Contracts;

/**
 * Rating summary of a product for the product page (E9). Implemented by the Reviews module;
 * without it no product has a rating.
 */
interface ProductRatings
{
    /**
     * Average of the approved reviews (one decimal, as a string) and their count, or null
     * when the product has none.
     *
     * @return array{average: string, count: int}|null
     */
    public function summary(string $productId): ?array;
}
