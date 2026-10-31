<?php

namespace App\Modules\Cms;

use App\Modules\Cms\Application\Contracts\PageDirectory;
use App\Modules\Cms\Infrastructure\EloquentPageDirectory;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Storefront content: pages (About, FAQ, Contact, policies), FAQ entries, contact form
 * messages and newsletter subscribers with double opt-in.
 */
class CmsServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(PageDirectory::class, EloquentPageDirectory::class);
    }

    public function boot(): void
    {
        parent::boot();

        // Public forms (ADR-015): a handful per visitor per hour.
        RateLimiter::for('contact', fn (Request $request) => Limit::perHour(5)->by($request->ip()));
        RateLimiter::for('newsletter', fn (Request $request) => Limit::perHour(5)->by($request->ip()));
    }

    protected function permissions(): array
    {
        return [
            'cms.manage' => 'Manage content pages and the FAQ, read contact messages, export newsletter subscribers',
        ];
    }
}
