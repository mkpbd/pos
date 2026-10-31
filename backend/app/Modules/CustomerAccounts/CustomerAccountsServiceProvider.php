<?php

namespace App\Modules\CustomerAccounts;

use App\Modules\CustomerAccounts\Application\Contracts\GuestCartMerger;
use App\Modules\CustomerAccounts\Application\Services\NoGuestCart;
use App\Modules\CustomerAccounts\Infrastructure\Auth\StorefrontCustomerProvider;
use App\Modules\CustomerAccounts\Infrastructure\EloquentCustomerOnlineAccounts;
use App\Modules\Customers\Application\Contracts\CustomerOnlineAccounts;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Online store accounts of customers (ADR-002): the `customer` session guard, sign-up,
 * sign-in/out, e-mail verification, password reset, profile and password, the shopper's
 * address endpoints (addresses are kept by Customers) and the staff switch that disables
 * online sign-in.
 */
class CustomerAccountsServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(CustomerOnlineAccounts::class, EloquentCustomerOnlineAccounts::class);
        // Replaced by the Cart module when it is installed.
        $this->app->bindIf(GuestCartMerger::class, NoGuestCart::class);
    }

    public function boot(): void
    {
        parent::boot();

        Auth::provider('storefront_customers', fn ($app, array $config) => new StorefrontCustomerProvider($app['hash'], $config['model']));

        // Same numbers as staff sign-in: per e-mail+IP and four times that per IP.
        RateLimiter::for('customer-auth', fn (Request $request) => [
            Limit::perMinute((int) config('pos.auth_rate_limit'))->by('customer-auth:'.mb_strtolower((string) $request->input('email')).'|'.$request->ip()),
            Limit::perMinute(4 * (int) config('pos.auth_rate_limit'))->by('customer-auth:'.$request->ip()),
        ]);
    }
}
