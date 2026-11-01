<?php

namespace App\Modules\Cart;

use App\Modules\Cart\Domain\CartOwner;
use App\Modules\Cart\Infrastructure\Console\PruneCartsCommand;
use App\Modules\Cart\Infrastructure\EloquentCustomerShoppingLists;
use App\Modules\Cart\Presentation\Http\Support\CartCookie;
use App\Modules\Cart\Presentation\Http\Support\CartIdempotencyScope;
use App\Modules\Cart\Presentation\Http\Support\CookieGuestCartMerger;
use App\Modules\CustomerAccounts\Application\Contracts\GuestCartMerger;
use App\Modules\Customers\Application\Contracts\CustomerShoppingLists;
use App\Modules\Shared\Infrastructure\Http\Middleware\ShopperIdempotencyScope;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\RateLimiter;

/**
 * The online store's cart (guests by cookie, customers by account; always repriced through
 * CartPricer) and the customers' wishlists, with the guest → customer merge on sign-in and
 * the daily prune of expired guest carts (`cart:prune`).
 */
class CartServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(GuestCartMerger::class, CookieGuestCartMerger::class);
        $this->app->bind(ShopperIdempotencyScope::class, CartIdempotencyScope::class);
        // E10b: wishlist and cart on the admin customer card.
        $this->app->bind(CustomerShoppingLists::class, EloquentCustomerShoppingLists::class);
    }

    public function boot(): void
    {
        parent::boot();

        // Coupon attempts (ADR-015, brute force): per customer, else per guest cart, else per IP.
        RateLimiter::for('coupon', function (Request $request) {
            $customerId = Auth::guard('customer')->id();
            $token = CartCookie::token($request);
            $who = $customerId !== null ? 'customer:'.$customerId : ($token !== null ? 'cart:'.CartOwner::hashToken($token) : 'ip:'.$request->ip());

            return Limit::perMinute((int) config('pos.coupon_rate_limit'))->by('coupon:'.$who);
        });

        if ($this->app->runningInConsole()) {
            $this->commands([PruneCartsCommand::class]);
        }
    }
}
