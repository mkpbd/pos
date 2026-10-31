<?php

namespace App\Modules\Cart\Presentation\Http\Support;

use App\Modules\Cart\Application\Actions\ShoppingCart;
use App\Modules\CustomerAccounts\Application\Contracts\GuestCartMerger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cookie;

/**
 * Merges the guest cart of the current request's cookie into the customer's cart on
 * sign-in/registration, then forgets the cookie.
 */
class CookieGuestCartMerger implements GuestCartMerger
{
    public function __construct(
        private readonly Request $request,
        private readonly ShoppingCart $carts,
    ) {}

    public function mergeGuestCart(string $customerId): array
    {
        $token = CartCookie::token($this->request);
        if ($token === null) {
            return ['merged_lines' => 0, 'capped_lines' => 0];
        }

        $result = $this->carts->merge($token, $customerId);
        Cookie::queue(CartCookie::forget($this->request));

        return $result;
    }
}
