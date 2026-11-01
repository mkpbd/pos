<?php

namespace App\Modules\Customers\Application\Contracts;

/**
 * The customer's product reviews for the customer card (E10b). Implemented by the Reviews
 * module; without it every customer has none.
 */
interface CustomerReviewStats
{
    /**
     * @return array{count: int, pending: int}
     */
    public function summary(string $customerId): array;
}
