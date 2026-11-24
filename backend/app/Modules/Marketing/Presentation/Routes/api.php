<?php

use App\Modules\Marketing\Presentation\Http\Controllers\CampaignController;
use App\Modules\Marketing\Presentation\Http\Controllers\MarketingStatsController;
use App\Modules\Marketing\Presentation\Http\Controllers\PageInsightsController;
use App\Modules\Marketing\Presentation\Http\Controllers\ShortLinkController;
use App\Modules\Marketing\Presentation\Http\Controllers\StoreInsightEventsController;
use App\Modules\Marketing\Presentation\Http\Controllers\StoreVisitController;
use App\Modules\Marketing\Presentation\Http\Controllers\TrackingSettingsController;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful;

// P2a: the storefront reports campaign visits (no session or CSRF; per-IP throttle).
Route::middleware(['storefront', 'throttle:storefront', 'throttle:visits'])->prefix('store')->group(function () {
    Route::post('visits', StoreVisitController::class)->name('store.visits');
});

// B15: store builder pages send insight beacons (sendBeacon: no session, cookies or CSRF — even
// from a Sanctum stateful origin; per-IP throttle).
Route::middleware(['storefront', 'throttle:insights'])->withoutMiddleware([EnsureFrontendRequestsAreStateful::class])
    ->prefix('store')->group(function () {
        Route::post('insights/events', StoreInsightEventsController::class)->name('store.insights.events');
    });

// B15: page insights for the store builder (storefront staff).
Route::prefix('storefront/builder')->middleware(['auth:sanctum', 'tenant', 'can:storefront.view'])->group(function () {
    Route::get('insights', [PageInsightsController::class, 'index']);
    Route::get('documents/{document}/insights', [PageInsightsController::class, 'show'])->whereUuid('document');
    // B13: A/B test results.
    Route::get('documents/{document}/experiments/{experiment}/results', [PageInsightsController::class, 'experiment'])
        ->whereUuid('document')->where('experiment', '[a-z][a-z0-9_-]{1,31}');
});

// P2a: Marketing — campaigns, short links and their stats.
Route::prefix('marketing')->middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::middleware('can:marketing.view')->group(function () {
        Route::get('campaigns', [CampaignController::class, 'index']);
        Route::get('campaigns/{campaign}', [CampaignController::class, 'show'])->whereUuid('campaign');
        Route::get('landing-pages', [CampaignController::class, 'landingPages']);
        Route::get('short-links', [ShortLinkController::class, 'index']);
        Route::get('short-links/{shortLink}', [ShortLinkController::class, 'show'])->whereUuid('shortLink');
        Route::get('stats', MarketingStatsController::class);
        // BD1c: ad pixels, Conversions API and pasted tracking code.
        Route::get('tracking', [TrackingSettingsController::class, 'show']);
    });

    Route::middleware('can:marketing.manage')->group(function () {
        Route::post('campaigns', [CampaignController::class, 'store']);
        Route::patch('campaigns/{campaign}', [CampaignController::class, 'update'])->whereUuid('campaign');
        Route::post('short-links', [ShortLinkController::class, 'store']);
        Route::patch('short-links/{shortLink}', [ShortLinkController::class, 'update'])->whereUuid('shortLink');
        Route::delete('short-links/{shortLink}', [ShortLinkController::class, 'destroy'])->whereUuid('shortLink');
        Route::patch('tracking', [TrackingSettingsController::class, 'update']);
        Route::post('tracking/test', [TrackingSettingsController::class, 'test'])->middleware('throttle:tracking-test');
    });
});
