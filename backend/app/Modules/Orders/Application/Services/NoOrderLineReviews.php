<?php

namespace App\Modules\Orders\Application\Services;

use App\Modules\Orders\Application\Contracts\OrderLineReviews;

/**
 * Default while no reviews module is installed.
 */
final class NoOrderLineReviews implements OrderLineReviews
{
    public function ofCustomer(string $customerId, array $productIds): array
    {
        return [];
    }
}
