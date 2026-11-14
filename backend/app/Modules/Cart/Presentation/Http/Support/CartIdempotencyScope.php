<?php

namespace App\Modules\Cart\Presentation\Http\Support;

use App\Modules\Cart\Domain\CartOwner;
use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\Shared\Infrastructure\Http\Middleware\ShopperIdempotencyScope;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

/**
 * Idempotency scope of a storefront request (ADR-014): the signed-in customer account, else
 * the guest's cart cookie token (by its hash, the same value carts.token_hash holds). The
 * scope survives the cart's conversion, so a retried checkout still finds its first answer.
 */
final class CartIdempotencyScope implements ShopperIdempotencyScope
{
    public function resolve(Request $request): ?string
    {
        $account = Auth::guard('customer')->user();
        if ($account instanceof CustomerAccount) {
            return 'customer:'.$account->id;
        }

        $token = CartCookie::token($request);

        return $token === null ? null : 'cart:'.CartOwner::hashToken($token);
    }

    public function resolveVisitor(Request $request): ?string
    {
        $account = Auth::guard('customer')->user();
        if ($account instanceof CustomerAccount) {
            return 'customer:'.$account->id;
        }
        $id = $request->hasSession() ? $request->session()->getId() : null;

        return is_string($id) && $id !== '' ? 'session:'.hash('sha256', $id) : null;
    }
}
