<?php

namespace App\Modules\Marketing;

use App\Modules\Cart\Application\Events\ProductAddedFromBuilderPage;
use App\Modules\Marketing\Application\Contracts\ConversionsApi;
use App\Modules\Marketing\Application\Contracts\MarketingLinks;
use App\Modules\Marketing\Application\Listeners\QueueMetaPurchase;
use App\Modules\Marketing\Application\Listeners\RecordExperimentAddToCart;
use App\Modules\Marketing\Infrastructure\Console\PrunePageInsightsCommand;
use App\Modules\Marketing\Infrastructure\Console\PruneVisitorHashesCommand;
use App\Modules\Marketing\Infrastructure\EloquentMarketingLinks;
use App\Modules\Marketing\Infrastructure\EloquentOrderCampaigns;
use App\Modules\Marketing\Infrastructure\EloquentStoreTracking;
use App\Modules\Marketing\Infrastructure\Meta\MetaConversionsClient;
use App\Modules\Orders\Application\Contracts\OrderCampaigns;
use App\Modules\Orders\Application\Events\OrderPlaced;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use App\Modules\Storefront\Application\Contracts\StoreTracking;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;

/**
 * P2a: marketing campaigns, short links (`/go/<code>` on the store host), campaign visits
 * without personal data and campaign stats over the web orders' attribution.
 * BD1c: ad pixels and tracking code (Meta pixel + Conversions API, GA4, TikTok, pasted code) —
 * the store's bootstrap and shell read them through Storefront's StoreTracking; placed shop and
 * landing-page orders are reported to the Conversions API (QueueMetaPurchase → SendMetaPurchaseJob).
 */
class MarketingServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        // The campaign of an order's attribution (declared by Orders).
        $this->app->bind(OrderCampaigns::class, EloquentOrderCampaigns::class);
        // P2b: campaigns and short links for social posts.
        $this->app->bind(MarketingLinks::class, EloquentMarketingLinks::class);
        // BD1c: the store's pixels and tracking code (declared by Storefront) and Meta's Conversions API.
        $this->app->bind(StoreTracking::class, EloquentStoreTracking::class);
        $this->app->bind(ConversionsApi::class, MetaConversionsClient::class);
    }

    public function boot(): void
    {
        parent::boot();

        // The storefront reports a campaign visit once per session; a little headroom per IP.
        RateLimiter::for('visits', fn (Request $request) => Limit::perMinute(20)->by('visits:'.$request->ip()));
        // B15: a page sends a beacon every 15 s and when hidden; room for a few open tabs. The
        // address is only the (hashed) limiter key in the cache, never stored.
        RateLimiter::for('insights', fn (Request $request) => Limit::perMinute(60)->by('insights:'.$request->ip()));
        // B13: add-to-carts per A/B test version.
        Event::listen(ProductAddedFromBuilderPage::class, RecordExperimentAddToCart::class);
        // BD1c: placed shop orders go to Meta's Conversions API (queued); a few test events per staff member.
        Event::listen(OrderPlaced::class, QueueMetaPurchase::class);
        RateLimiter::for('tracking-test', fn (Request $request) => Limit::perMinute(5)->by('tracking-test|'.($request->user()?->getAuthIdentifier() ?: $request->ip())));

        if ($this->app->runningInConsole()) {
            $this->commands([PruneVisitorHashesCommand::class, PrunePageInsightsCommand::class]);
        }
    }

    protected function permissions(): array
    {
        return [
            'marketing.view' => 'View marketing campaigns, short links and campaign statistics',
            'marketing.manage' => 'Create and change marketing campaigns, short links and the ad pixels (tracking code needs storefront.custom_html too)',
        ];
    }
}
