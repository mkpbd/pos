<?php

namespace App\Modules\Cart\Presentation\Http\Controllers;

use App\Modules\Cart\Application\Actions\ShoppingCart;
use App\Modules\Cart\Application\Services\CartPricer;
use App\Modules\Cart\Presentation\Http\Support\CartCookie;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The visitor's cart: the signed-in customer's, or a guest's found by the httpOnly
 * `cart_token` cookie. Every response is the freshly repriced cart.
 */
class CartController
{
    private const QUANTITY = ['required', 'numeric', 'gt:0', 'max:999', 'regex:/^\d{1,3}(\.\d{1,3})?$/'];

    public function __construct(
        private readonly ShoppingCart $carts,
        private readonly CartPricer $pricer,
    ) {}

    /**
     * Cart
     *
     * Repriced from the live catalog on every read. Lines that are unavailable or out of stock
     * stay listed (flagged) but do not count; a line above the stock counts with `max_quantity`
     * (`exceeds_stock`). `issues` lists `unavailable`, `out_of_stock`, `exceeds_stock`.
     */
    public function show(Request $request): JsonResponse
    {
        return ApiResponse::success($this->pricer->price($this->carts->find(CartCookie::owner($request))));
    }

    /**
     * Add to cart
     *
     * Adds to the line of the same variant. Errors: `VARIANT_NOT_PURCHASABLE`, `OUT_OF_STOCK`,
     * `INSUFFICIENT_STOCK` (details.max_quantity), `CART_FULL`; whole units unless the unit
     * allows decimals (3 places), at most 999.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate(['variant_id' => ['required', 'uuid'], 'quantity' => self::QUANTITY]);
        [$cart, $token] = $this->carts->add(CartCookie::owner($request), $data['variant_id'], (string) $data['quantity']);

        $response = ApiResponse::success($this->pricer->price($cart));

        return $token === null ? $response : $response->withCookie(CartCookie::issue($request, $token));
    }

    /**
     * Change a line's quantity
     */
    public function update(Request $request, string $itemId): JsonResponse
    {
        $data = $request->validate(['quantity' => self::QUANTITY]);

        return ApiResponse::success($this->pricer->price($this->carts->update(CartCookie::owner($request), $itemId, (string) $data['quantity'])));
    }

    /**
     * Remove a line
     */
    public function destroy(Request $request, string $itemId): JsonResponse
    {
        return ApiResponse::success($this->pricer->price($this->carts->remove(CartCookie::owner($request), $itemId)));
    }

    /**
     * Empty the cart
     */
    public function clear(Request $request): JsonResponse
    {
        $this->carts->clear(CartCookie::owner($request));

        return ApiResponse::success($this->pricer->price(null));
    }
}
