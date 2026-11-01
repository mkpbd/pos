<?php

namespace App\Modules\Customers\Application\Contracts;

/**
 * The customer's web orders and returns for the customer card's "Web activity" (E10b).
 * Implemented by the Orders module; without it every customer has none.
 */
interface CustomerWebOrders
{
    /**
     * `orders.count`: orders except cancelled and failed ones; `total_spent`: paid minus
     * refunded over all orders; `average_order`: total_spent / orders with money received
     * ("0.00" without); `last_order_at`: newest placement (any status). `returns_count`:
     * returns except cancelled ones. `recent_orders`: the five newest orders.
     *
     * @return array{
     *   orders: array{count: int, total_spent: string, last_order_at: ?string, average_order: string},
     *   returns_count: int,
     *   recent_orders: list<array{id: string, number: string, placed_at: string, status: string, status_label: string, payment_status: string, total: string, currency: string}>
     * }
     */
    public function summary(string $customerId): array;
}
