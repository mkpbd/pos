<?php

namespace App\Modules\Shipping;

use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use App\Modules\Shipping\Application\Contracts\CourierDirectory;
use App\Modules\Shipping\Application\Contracts\ShippingRates;
use App\Modules\Shipping\Infrastructure\EloquentCourierDirectory;
use App\Modules\Shipping\Infrastructure\EloquentShippingRates;
use App\Modules\Shipping\Infrastructure\Models\Courier;
use Illuminate\Support\Facades\Route;

/**
 * Delivery for the online store (E8a): zones (sets of districts, one zone per district),
 * delivery methods per zone (flat fee, free-over threshold, cash-on-delivery rules, ETA) and
 * the storefront lookup of methods for a district; couriers with their tracking link template
 * (E10a, `CourierDirectory`). Shipments belong to the Orders module.
 */
class ShippingServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(ShippingRates::class, EloquentShippingRates::class);
        $this->app->bind(CourierDirectory::class, EloquentCourierDirectory::class);
    }

    public function boot(): void
    {
        Route::model('courier', Courier::class);

        parent::boot();
    }

    protected function permissions(): array
    {
        return [
            'shipping.manage' => 'Manage delivery zones, delivery methods and couriers of the online store',
        ];
    }
}
