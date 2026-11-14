<?php

namespace App\Modules\Social;

use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use App\Modules\Social\Domain\Meta\MetaGraphClients;
use App\Modules\Social\Infrastructure\Console\PublishDueSocialPostsCommand;
use App\Modules\Social\Infrastructure\Meta\ContainerMetaGraphClients;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/**
 * P2b: social media — Facebook & Instagram posting (sandbox or live Meta Graph API, connect,
 * posts, queued publishing, scheduler, caption suggestions) and catalog feeds for Meta, TikTok
 * and Pinterest. Reads the catalog (OnlineCatalog CatalogFeed / StorefrontCatalog), photos
 * (Products ProductDirectory, Media MediaLibrary), campaigns and short links (Marketing
 * MarketingLinks), the store's address and languages (Storefront StorefrontConfig) and AI
 * (Shared AiTextWriter) through contracts.
 */
class SocialServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(MetaGraphClients::class, ContainerMetaGraphClients::class);
    }

    public function boot(): void
    {
        parent::boot();

        // Caption ideas may call the AI provider: a little per staff member.
        RateLimiter::for('social-captions', fn (Request $request) => Limit::perMinute(20)->by('social-captions|'.($request->user()?->getAuthIdentifier() ?: $request->ip())));
        RateLimiter::for('social-connect', fn (Request $request) => Limit::perMinute(20)->by('social-connect|'.$request->ip()));
        // Catalog crawlers fetch a feed now and then; generous per address.
        RateLimiter::for('social-feeds', fn (Request $request) => Limit::perMinute(60)->by('social-feeds|'.$request->ip()));

        if ($this->app->runningInConsole()) {
            $this->commands([PublishDueSocialPostsCommand::class]);
        }
    }

    protected function permissions(): array
    {
        return [
            'social.view' => 'View social media settings, the connected Facebook Page, posts and product feeds',
            'social.manage' => 'Connect Facebook and Instagram, write, schedule and publish posts, and manage product feeds',
        ];
    }
}
