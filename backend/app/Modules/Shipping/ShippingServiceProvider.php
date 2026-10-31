<?php

namespace App\Modules\Shipping;

use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use App\Modules\Shipping\Application\Contracts\ShippingRates;
use App\Modules\Shipping\Infrastructure\EloquentShippingRates;

/**
 * Delivery for the online store (E8a): zones (sets of districts, one zone per district),
 * delivery methods per zone (flat fee, free-over threshold, cash-on-delivery rules, ETA) and
 * the storefront lookup of methods for a district. Couriers and shipments arrive in E10.
 */
class ShippingServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(ShippingRates::class, EloquentShippingRates::class);
    }

    protected function permissions(): array
    {
        return [
            'shipping.manage' => 'Manage delivery zones and delivery methods of the online store',
        ];
    }
}
