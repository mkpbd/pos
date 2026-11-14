<?php

use App\Modules\Marketing\Presentation\Http\Controllers\CampaignController;
use App\Modules\Marketing\Presentation\Http\Controllers\MarketingStatsController;
use App\Modules\Marketing\Presentation\Http\Controllers\ShortLinkController;
use App\Modules\Marketing\Presentation\Http\Controllers\StoreVisitController;
use Illuminate\Support\Facades\Route;

// P2a: the storefront reports campaign visits (no session or CSRF; per-IP throttle).
Route::middleware(['storefront', 'throttle:storefront', 'throttle:visits'])->prefix('store')->group(function () {
    Route::post('visits', StoreVisitController::class)->name('store.visits');
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
    });

    Route::middleware('can:marketing.manage')->group(function () {
        Route::post('campaigns', [CampaignController::class, 'store']);
        Route::patch('campaigns/{campaign}', [CampaignController::class, 'update'])->whereUuid('campaign');
        Route::post('short-links', [ShortLinkController::class, 'store']);
        Route::patch('short-links/{shortLink}', [ShortLinkController::class, 'update'])->whereUuid('shortLink');
        Route::delete('short-links/{shortLink}', [ShortLinkController::class, 'destroy'])->whereUuid('shortLink');
    });
});
