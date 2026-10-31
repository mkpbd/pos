<?php

namespace App\Modules\Shared\Infrastructure\Http\Middleware;

use Illuminate\Http\Request;

/**
 * Who a storefront request belongs to, for idempotency keys (ADR-014): `customer:{account id}`
 * for a signed-in shopper, `cart:{sha256 of the cart cookie token}` for a guest with a cart,
 * null for a guest without one. Implemented by the Cart module (it owns the cart cookie).
 */
interface ShopperIdempotencyScope
{
    public function resolve(Request $request): ?string;
}
