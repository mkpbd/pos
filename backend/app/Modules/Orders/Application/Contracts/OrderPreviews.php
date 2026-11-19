<?php

namespace App\Modules\Orders\Application\Contracts;

/**
 * B14: web orders for the store builder's order page sample (organization from the tenant
 * context). Builder users need not have web order access, so everything personal is masked:
 * the shopper's first name only, e-mail and phone partly hidden, no street address, postcode,
 * tracking number or link.
 */
interface OrderPreviews
{
    /**
     * The newest web orders (number and when placed), newest first.
     *
     * @return list<array{number: string, placed_at: string}>
     */
    public function recent(int $limit): array;

    /**
     * The storefront order view (GET /store/orders/{number}) of an order by id or number, or (null)
     * the newest order — masked; null when there is none.
     *
     * @return array<string, mixed>|null
     */
    public function masked(?string $idOrNumber): ?array;

    /**
     * A made-up order view (number SAMPLE-1001, cash on delivery, confirmed, delivery in 2–3
     * days) with one line per given product (quantity 1); totals worked out with Decimal.
     *
     * @param  list<array{name: string, price: string, image_url: ?string, product_url: ?string}>  $products
     * @return array<string, mixed>
     */
    public function sample(array $products, string $currency, bool $pricesIncludeTax): array;
}
