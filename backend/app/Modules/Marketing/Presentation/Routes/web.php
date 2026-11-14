<?php

use App\Modules\Marketing\Presentation\Http\Controllers\ShortLinkRedirectController;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Route;
use Illuminate\View\Middleware\ShareErrorsFromSession;

// P2a: short links on the store host — no session or cookie; 302 to the target (or to "/").
Route::withoutMiddleware([StartSession::class, ShareErrorsFromSession::class, PreventRequestForgery::class, AddQueuedCookiesToResponse::class])
    ->middleware(['storefront:web', 'throttle:storefront'])
    ->get('go/{code}', ShortLinkRedirectController::class)
    ->where('code', '[A-Za-z0-9-]{1,64}')
    ->name('storefront.short-link');
