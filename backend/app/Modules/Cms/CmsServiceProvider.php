<?php

namespace App\Modules\Cms;

use App\Modules\Cms\Application\Contracts\BlogDirectory;
use App\Modules\Cms\Application\Contracts\PageDirectory;
use App\Modules\Cms\Infrastructure\BlogMediaReferences;
use App\Modules\Cms\Infrastructure\EloquentBlogDirectory;
use App\Modules\Cms\Infrastructure\EloquentPageDirectory;
use App\Modules\Media\Application\Contracts\MediaReferences;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Storefront content: pages (About, FAQ, Contact, policies), FAQ entries, contact form
 * messages, newsletter subscribers with double opt-in and the blog (E11).
 */
class CmsServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(PageDirectory::class, EloquentPageDirectory::class);
        $this->app->bind(BlogDirectory::class, EloquentBlogDirectory::class);
        $this->app->tag([BlogMediaReferences::class], MediaReferences::TAG);
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
            'cms.manage' => 'Manage content pages, the FAQ and the blog, read contact messages, export newsletter subscribers',
        ];
    }
}
