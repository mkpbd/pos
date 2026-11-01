<?php

namespace App\Modules\Orders\Application\Actions;

use App\Modules\Cart\Application\Actions\ShoppingCart;
use App\Modules\Cart\Application\Services\CartPricer;
use App\Modules\Cart\Domain\CartOwner;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderLine;

/**
 * "Buy again" (E9): every line's variant goes into the customer's cart with the ordered
 * quantity through the cart service (merging with what is there, within the cart's line and
 * quantity rules). Lines that cannot be added are reported, not failed: `unavailable`,
 * `out_of_stock`, `limit`. Prices are today's — the cart is repriced as always.
 */
class ReorderOwnOrder
{
    public function __construct(
        private readonly ShoppingCart $carts,
        private readonly CartPricer $pricer,
    ) {}

    /**
     * @return array{cart: array<string, mixed>, added: list<array{variant_id: string, name: string, quantity: string}>, skipped: list<array{name: string, reason: string}>}
     */
    public function __invoke(Order $order, string $customerId): array
    {
        $lines = $order->lines()->get()->map(fn (OrderLine $l) => [
            'variant_id' => $l->variant_id,
            'quantity' => (string) $l->quantity,
            'name' => $l->product_name.($l->variant_name !== null && $l->variant_name !== '' && $l->variant_name !== $l->product_name ? " ({$l->variant_name})" : ''),
        ])->values()->all();

        $result = $this->carts->addLines(CartOwner::customer($customerId), $lines);

        return [
            'cart' => $this->pricer->price($result['cart']),
            'added' => $result['added'],
            'skipped' => $result['skipped'],
        ];
    }
}
