<?php

namespace App\Modules\Customers\Application\Contracts;

/**
 * The customer's wishlist and cart for the customer card (E10b). Implemented by the Cart
 * module; without it every customer has none.
 */
interface CustomerShoppingLists
{
    /**
     * `cart` is null without a cart or with an empty one; `item_count` is the number of units
     * ("3", "1.5"); `updated_at` the last change of the cart or its lines.
     *
     * @return array{wishlist_count: int, cart: array{item_count: string, updated_at: ?string}|null}
     */
    public function summary(string $customerId): array;
}
