<?php

namespace App\Modules\Storefront;

use App\Modules\Cms\Application\Contracts\PageReferences;
use App\Modules\Media\Application\Contracts\MediaReferences;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use App\Modules\Storefront\Infrastructure\MenuPageReferences;
use App\Modules\Storefront\Infrastructure\SectionMediaReferences;
use App\Modules\Storefront\Infrastructure\ThemeMediaReferences;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\RateLimiter;

/**
 * The online storefront's configuration (settings, domains, theme, menus, banners,
 * homepage sections), host-based storefront resolution, the public bootstrap and
 * homepage API and the HTML shell.
 */
class StorefrontServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->tag([ThemeMediaReferences::class, SectionMediaReferences::class], MediaReferences::TAG);
        $this->app->tag([MenuPageReferences::class], PageReferences::TAG);
    }

    public function boot(): void
    {
        parent::boot();

        $this->loadViewsFrom(__DIR__.'/Presentation/Views', 'storefront');

        // Public reads: generous per visitor IP (ADR-015).
        RateLimiter::for('storefront', fn (Request $request) => Limit::perMinute(300)->by($request->ip()));
        // Shopper writes (cart, wishlist, addresses, profile): per IP, and per signed-in customer.
        RateLimiter::for('storefront-write', fn (Request $request) => array_values(array_filter([
            Limit::perMinute(60)->by('ip:'.$request->ip()),
            ($customerId = Auth::guard('customer')->id()) === null ? null : Limit::perMinute(60)->by('customer:'.$customerId),
        ])));
    }

    protected function permissions(): array
    {
        return [
            'storefront.view' => 'View online store settings, theme, menus, banners and homepage; preview the storefront',
            'storefront.manage' => 'Change online store settings, domains, theme, menus, banners and homepage sections',
            'storefront.custom_css' => 'Edit the online store\'s custom CSS',
        ];
    }
}
