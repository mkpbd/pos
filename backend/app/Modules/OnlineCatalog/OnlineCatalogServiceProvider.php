<?php

namespace App\Modules\OnlineCatalog;

use App\Modules\Inventory\Application\Events\StockBecameAvailable;
use App\Modules\Media\Application\Contracts\MediaReferences;
use App\Modules\OnlineCatalog\Application\Contracts\CatalogFeed;
use App\Modules\OnlineCatalog\Application\Contracts\ProductPageZones;
use App\Modules\OnlineCatalog\Application\Contracts\ProductQuestionCounts;
use App\Modules\OnlineCatalog\Application\Contracts\ProductRatings;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\OnlineCatalog\Application\Services\NoProductPageZones;
use App\Modules\OnlineCatalog\Application\Services\NoProductQuestions;
use App\Modules\OnlineCatalog\Application\Services\NoProductRatings;
use App\Modules\OnlineCatalog\Infrastructure\Console\ComputeAffinitiesCommand;
use App\Modules\OnlineCatalog\Infrastructure\Console\RefreshProductStatsCommand;
use App\Modules\OnlineCatalog\Infrastructure\ListingMediaReferences;
use App\Modules\OnlineCatalog\Infrastructure\ListingVariantWebData;
use App\Modules\OnlineCatalog\Infrastructure\Notifications\NotifyBackInStock;
use App\Modules\OnlineCatalog\Infrastructure\ReadModelCatalogFeed;
use App\Modules\OnlineCatalog\Infrastructure\ReadModelStorefrontCatalog;
use App\Modules\Products\Application\Contracts\VariantWebData;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;

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
        // P2b: product feeds for Meta, TikTok and Pinterest catalogs (Social).
        $this->app->bind(CatalogFeed::class, ReadModelCatalogFeed::class);
        $this->app->tag([ListingMediaReferences::class], MediaReferences::TAG);
        // Replaced by the Reviews module when it is installed.
        $this->app->bindIf(ProductRatings::class, NoProductRatings::class);
        // P1b: published question counts (Reviews) and the product page's builder zones (Storefront).
        $this->app->bindIf(ProductQuestionCounts::class, NoProductQuestions::class);
        $this->app->bindIf(ProductPageZones::class, NoProductPageZones::class);
        // P1a: compare-at prices and back-in-stock counts in the product variant grid.
        $this->app->bind(VariantWebData::class, ListingVariantWebData::class);
    }

    public function boot(): void
    {
        parent::boot();

        Event::listen(StockBecameAvailable::class, NotifyBackInStock::class);
        // P1a: "notify me" requests, a handful per visitor per hour.
        RateLimiter::for('back-in-stock', fn (Request $request) => Limit::perHour(10)->by('back-in-stock:'.$request->ip()));

        if ($this->app->runningInConsole()) {
            $this->commands([RefreshProductStatsCommand::class, ComputeAffinitiesCommand::class]);
        }
    }

    protected function permissions(): array
    {
        return [
            'online_catalog.view' => 'View the web listings of products, categories and brands',
            'online_catalog.manage' => 'Publish products online and edit web listings, compare-at prices, related products, size guides, product videos and badges',
        ];
    }
}
