<?php

namespace App\Modules\StoredValue;

use App\Modules\Customers\Application\Contracts\CustomerStoreCredit;
use App\Modules\Sales\Application\Contracts\GiftCards;
use App\Modules\Sales\Application\Contracts\StoreCredit;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use App\Modules\StoredValue\Application\Services\EloquentGiftCards;
use App\Modules\StoredValue\Application\Services\EloquentStoreCredit;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/**
 * POS1b: value customers hold with the business — store credit (customer advances, refunds to
 * credit) and gift cards / vouchers / credit notes. Plugs into Sales through Sales'
 * StoreCredit and GiftCards contracts (payment methods at the till and refund methods).
 */
class StoredValueServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(StoreCredit::class, EloquentStoreCredit::class);
        $this->app->bind(CustomerStoreCredit::class, EloquentStoreCredit::class);
        // §2: gift cards / vouchers / credit notes for Sales (tenders and return refunds).
        $this->app->bind(GiftCards::class, EloquentGiftCards::class);
    }

    public function boot(): void
    {
        // §2: the till's gift card balance check (guessing codes is throttled per user).
        RateLimiter::for('gift-card-lookup', fn (Request $request) => Limit::perMinute(20)->by('gift-card-lookup:'.($request->user()?->getAuthIdentifier() ?? $request->ip())));

        parent::boot();
    }

    protected function permissions(): array
    {
        return [
            'store_credit.view' => "See customers' store credit",
            'store_credit.manage' => 'Adjust store credit and pay it out',
            'gift_cards.view' => 'See gift cards and vouchers',
            'gift_cards.manage' => 'Issue vouchers and void gift cards',
        ];
    }
}
