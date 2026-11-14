<?php

namespace App\Modules\Marketing;

use App\Modules\Marketing\Application\Contracts\MarketingLinks;
use App\Modules\Marketing\Infrastructure\Console\PruneVisitorHashesCommand;
use App\Modules\Marketing\Infrastructure\EloquentMarketingLinks;
use App\Modules\Marketing\Infrastructure\EloquentOrderCampaigns;
use App\Modules\Orders\Application\Contracts\OrderCampaigns;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/**
 * P2a: marketing campaigns, short links (`/go/<code>` on the store host), campaign visits
 * without personal data and campaign stats over the web orders' attribution.
 */
class MarketingServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        // The campaign of an order's attribution (declared by Orders).
        $this->app->bind(OrderCampaigns::class, EloquentOrderCampaigns::class);
        // P2b: campaigns and short links for social posts.
        $this->app->bind(MarketingLinks::class, EloquentMarketingLinks::class);
    }

    public function boot(): void
    {
        parent::boot();

        // The storefront reports a campaign visit once per session; a little headroom per IP.
        RateLimiter::for('visits', fn (Request $request) => Limit::perMinute(20)->by('visits:'.$request->ip()));

        if ($this->app->runningInConsole()) {
            $this->commands([PruneVisitorHashesCommand::class]);
        }
    }

    protected function permissions(): array
    {
        return [
            'marketing.view' => 'View marketing campaigns, short links and campaign statistics',
            'marketing.manage' => 'Create and change marketing campaigns and short links',
        ];
    }
}
