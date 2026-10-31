<?php

namespace App\Modules\Cart\Presentation\Http\Support;

use App\Modules\Cart\Domain\CartOwner;
use App\Modules\Cart\Domain\CartRules;
use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Cookie;

/**
 * The guest cart cookie: httpOnly, SameSite=Lax, Secure on HTTPS, 30 days. It holds the
 * random token whose sha256 identifies the guest cart (encrypted like every app cookie).
 */
final class CartCookie
{
    public const NAME = 'cart_token';

    public static function token(Request $request): ?string
    {
        $token = $request->cookie(self::NAME);

        return is_string($token) && preg_match('/^[A-Za-z0-9_-]{40,80}$/', $token) === 1 ? $token : null;
    }

    /**
     * The signed-in customer's cart, else the guest cart of the cookie.
     */
    public static function owner(Request $request): CartOwner
    {
        $account = Auth::guard('customer')->user();

        return $account instanceof CustomerAccount ? CartOwner::customer($account->customer_id) : CartOwner::guest(self::token($request));
    }

    public static function issue(Request $request, string $token): Cookie
    {
        return cookie(self::NAME, $token, CartRules::GUEST_TTL_DAYS * 24 * 60, '/', null, $request->isSecure(), true, false, 'lax');
    }

    public static function forget(Request $request): Cookie
    {
        return cookie(self::NAME, '', -2628000, '/', null, $request->isSecure(), true, false, 'lax');
    }
}
