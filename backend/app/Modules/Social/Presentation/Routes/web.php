<?php

use App\Modules\Social\Presentation\Http\Controllers\MetaConnectController;
use App\Modules\Social\Presentation\Http\Controllers\PublicFeedController;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Route;
use Illuminate\View\Middleware\ShareErrorsFromSession;

// P2b: connecting Facebook — top-level browser navigations of a signed-in staff member. They run
// in the web group so the session cookie authenticates them even when Facebook is the referrer
// (the API group only starts sessions for first-party referrers); every outcome is a redirect.
Route::prefix('api/v1/social/meta')->middleware('throttle:social-connect')->group(function () {
    Route::get('connect', [MetaConnectController::class, 'connect'])->name('social.meta.connect');
    Route::get('callback', [MetaConnectController::class, 'callback'])->name('social.meta.callback');
});

// P2b: catalog feeds for Meta, TikTok and Pinterest on any host (the token is the key); no
// session or cookie. Registered before the storefront's catch-all page route.
Route::withoutMiddleware([StartSession::class, ShareErrorsFromSession::class, PreventRequestForgery::class, AddQueuedCookiesToResponse::class])
    ->middleware('throttle:social-feeds')
    ->get('feeds/{channel}/{token}.{format}', PublicFeedController::class)
    ->where(['channel' => 'meta|tiktok|pinterest', 'token' => '[A-Fa-f0-9]{64}', 'format' => 'xml|csv'])
    ->name('social.feed');
