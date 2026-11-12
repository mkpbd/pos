<?php

namespace App\Modules\Promotions;

use App\Modules\Promotions\Application\Contracts\CatalogPromotions;
use App\Modules\Promotions\Application\Contracts\PromotionPricing;
use App\Modules\Promotions\Application\Contracts\PromotionRedemptions;
use App\Modules\Promotions\Application\Contracts\PromotionShowcase;
use App\Modules\Promotions\Infrastructure\EloquentCatalogPromotions;
use App\Modules\Promotions\Infrastructure\EloquentPromotionPricing;
use App\Modules\Promotions\Infrastructure\EloquentPromotionRedemptions;
use App\Modules\Promotions\Infrastructure\EloquentPromotionShowcase;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;

/**
 * Promotions of the online store (E8b, web channel only; POS promotions later): automatic
 * offers, coupon codes, flash sales with a countdown and free delivery, priced by the pure
 * PromotionEngine and consumed through contracts by Cart (pricing), Orders (redemptions at
 * placement), OnlineCatalog (product display) and Storefront (hot deals; B4: the builder's
 * countdown and discount elements through PromotionShowcase).
 */
class PromotionsServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(PromotionPricing::class, EloquentPromotionPricing::class);
        $this->app->bind(CatalogPromotions::class, EloquentCatalogPromotions::class);
        $this->app->bind(PromotionRedemptions::class, EloquentPromotionRedemptions::class);
        // B4: countdown and discount elements of the store builder.
        $this->app->bind(PromotionShowcase::class, EloquentPromotionShowcase::class);
    }

    protected function permissions(): array
    {
        return [
            'promotions.view' => 'View online store promotions, coupon codes and their use',
            'promotions.manage' => 'Create and change online store promotions and coupon codes',
        ];
    }
}
