<?php

use App\Modules\Storefront\Presentation\Http\Controllers\DemoGalleryController;
use App\Modules\Storefront\Presentation\Http\Controllers\StorefrontSeoController;
use App\Modules\Storefront\Presentation\Http\Controllers\StorefrontShellController;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Route;
use Illuminate\View\Middleware\ShareErrorsFromSession;

// E12: robots.txt and the sitemaps are the same for everyone and publicly cacheable, so
// they start no session and set no cookie.
Route::withoutMiddleware([StartSession::class, ShareErrorsFromSession::class, PreventRequestForgery::class, AddQueuedCookiesToResponse::class])->group(function () {
    // robots.txt answers every host (unknown and closed ones get "Disallow: /"), so it does
    // not go through the storefront resolution that would 404.
    Route::middleware('throttle:storefront')->get('robots.txt', [StorefrontSeoController::class, 'robots'])->name('storefront.robots');

    // XML sitemaps of the open store (closed store → 404).
    Route::middleware(['storefront:web', 'throttle:storefront'])->group(function () {
        Route::get('sitemap.xml', [StorefrontSeoController::class, 'sitemap'])->name('storefront.sitemap');
        Route::get('sitemaps/{name}.xml', [StorefrontSeoController::class, 'sitemap'])->where('name', '[a-z0-9-]{1,40}');
    });

    // T2: the demo gallery page answers every host (a store is not needed); 404 while off.
    Route::middleware('throttle:storefront')->get('demos', [DemoGalleryController::class, 'page'])->name('storefront.demos');
});

// Every storefront page is served by the shell. Paths owned by the API, auth, files,
// the admin SPA and tooling are excluded.
Route::middleware(['storefront:web', 'throttle:storefront'])
    ->get('{path?}', StorefrontShellController::class)
    ->where('path', '^(?!(api|sanctum|storage|admin|docs|up)(/|$)).*$')
    ->name('storefront.shell');
