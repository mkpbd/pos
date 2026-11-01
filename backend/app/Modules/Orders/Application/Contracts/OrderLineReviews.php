<?php

namespace App\Modules\Orders\Application\Contracts;

/**
 * The customer's own reviews of the products on an order, for the account order page (E9).
 * Implemented by the Reviews module; without it nobody has reviewed anything.
 */
interface OrderLineReviews
{
    /**
     * @param  list<string>  $productIds
     * @return array<string, array{id: string, rating: int, status: string}> keyed by product id
     */
    public function ofCustomer(string $customerId, array $productIds): array;
}
