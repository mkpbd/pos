<?php

namespace App\Modules\Cart;

use App\Modules\Cart\Infrastructure\Console\PruneCartsCommand;
use App\Modules\Cart\Presentation\Http\Support\CartIdempotencyScope;
use App\Modules\Cart\Presentation\Http\Support\CookieGuestCartMerger;
use App\Modules\Shared\Infrastructure\Http\Middleware\ShopperIdempotencyScope;
use App\Modules\CustomerAccounts\Application\Contracts\GuestCartMerger;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;

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
    }

    public function boot(): void
    {
        parent::boot();

        if ($this->app->runningInConsole()) {
            $this->commands([PruneCartsCommand::class]);
        }
    }
}
