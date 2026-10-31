<?php

namespace App\Modules\OnlineCatalog;

use App\Modules\Media\Application\Contracts\MediaReferences;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\OnlineCatalog\Infrastructure\Console\RefreshProductStatsCommand;
use App\Modules\OnlineCatalog\Infrastructure\ListingMediaReferences;
use App\Modules\OnlineCatalog\Infrastructure\ReadModelStorefrontCatalog;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;

/**
 * The online catalog: web listings of products, categories and brands (addresses,
 * publishing schedule, descriptions, SEO, compare-at prices, related products), the
 * popularity projection, and the public shop API (listing with facets, product pages,
 * category/brand pages, search suggestions).
 */
class OnlineCatalogServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(StorefrontCatalog::class, ReadModelStorefrontCatalog::class);
        $this->app->tag([ListingMediaReferences::class], MediaReferences::TAG);
    }

    public function boot(): void
    {
        parent::boot();

        if ($this->app->runningInConsole()) {
            $this->commands([RefreshProductStatsCommand::class]);
        }
    }

    protected function permissions(): array
    {
        return [
            'online_catalog.view' => 'View the web listings of products, categories and brands',
            'online_catalog.manage' => 'Publish products online and edit web listings, compare-at prices and related products',
        ];
    }
}
