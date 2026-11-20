<?php

namespace App\Modules\Orders\Application\Contracts;

/**
 * AI2b: a signed-in shopper's own web orders as the shop assistant may describe them
 * (organization from the tenant context). Only orders placed while signed in to that customer's
 * account (`orders.customer_id`); another customer's order, another store's order and unknown
 * numbers are all simply absent. Never addresses, phone numbers, e-mail addresses, notes or
 * ids. Amounts are decimal strings in the order's currency.
 *
 * @phpstan-type OrderSummary array{
 *   number: string, placed_at: string, status: string, status_label: string, payment_status: string,
 *   payment_status_label: string, total: string, currency: string, item_count: string, items: list<string>
 * }
 */
interface CustomerOrderStatus
{
    /**
     * The customer's newest orders, newest first; `items` = product names (at most 5).
     *
     * @return list<OrderSummary>
     */
    public function recent(string $customerId, int $limit): array;

    /**
     * One of the customer's orders by number (case-insensitive), or null: the summary plus the
     * payment method, lines `{name, quantity}` (at most 10), delivery method and estimated
     * days, the shipment (`{status, status_label, courier, tracking_url}` or null), `can_cancel`
     * (the shopper may cancel it on the order page), `returnable` (a return can be requested
     * now), `return_deadline` (ISO, null before delivery or with returns off).
     *
     * @return array<string, mixed>|null
     */
    public function find(string $customerId, string $number): ?array;
}
