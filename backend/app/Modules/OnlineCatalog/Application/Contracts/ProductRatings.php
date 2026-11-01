<?php

namespace App\Modules\OnlineCatalog\Application\Contracts;

/**
 * Rating summaries of products: the product page (E9) and, batched, product cards and the
 * "top rated" sort (E10b). Implemented by the Reviews module; without it no product has a
 * rating.
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

    /**
     * The same for many products in one query; products without approved reviews are absent.
     *
     * @param  list<string>  $productIds
     * @return array<string, array{average: string, count: int}>
     */
    public function summaries(array $productIds): array;
}
