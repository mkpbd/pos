<?php

namespace App\Modules\Storefront;

use App\Modules\Media\Application\Contracts\MediaReferences;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use App\Modules\Storefront\Infrastructure\ThemeMediaReferences;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/**
 * The online storefront's configuration (settings, domains, theme, menus), host-based
 * storefront resolution, the public bootstrap API and the HTML shell.
 */
class StorefrontServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->tag([ThemeMediaReferences::class], MediaReferences::TAG);
    }

    public function boot(): void
    {
        parent::boot();

        $this->loadViewsFrom(__DIR__.'/Presentation/Views', 'storefront');

        // Public reads: generous per visitor IP (ADR-015).
        RateLimiter::for('storefront', fn (Request $request) => Limit::perMinute(300)->by($request->ip()));
    }

    protected function permissions(): array
    {
        return [
            'storefront.view' => 'View online store settings, theme and menus; preview a closed storefront',
            'storefront.manage' => 'Change online store settings, domains, theme and menus',
            'storefront.custom_css' => 'Edit the online store\'s custom CSS',
        ];
    }
}
