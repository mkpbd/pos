<?php

use App\Modules\Storefront\Presentation\Http\Controllers\MenuController;
use App\Modules\Storefront\Presentation\Http\Controllers\StoreBootstrapController;
use App\Modules\Storefront\Presentation\Http\Controllers\StorefrontAdminController;
use Illuminate\Support\Facades\Route;

// Public storefront API: organization from the host name, no authentication.
Route::middleware(['storefront', 'throttle:storefront'])->prefix('store')->group(function () {
    Route::get('bootstrap', StoreBootstrapController::class)->name('store.bootstrap');
});

// Storefront administration.
Route::middleware(['auth:sanctum', 'tenant'])->prefix('storefront')->group(function () {
    Route::middleware('can:storefront.view')->group(function () {
        Route::get('settings', [StorefrontAdminController::class, 'showSettings']);
        Route::get('domains', [StorefrontAdminController::class, 'domains']);
        Route::get('theme', [StorefrontAdminController::class, 'showTheme']);
        Route::get('menus', [MenuController::class, 'index']);
        Route::get('menus/{menu}', [MenuController::class, 'show'])->whereUuid('menu');
    });

    Route::middleware('can:storefront.manage')->group(function () {
        Route::patch('settings', [StorefrontAdminController::class, 'updateSettings']);
        Route::post('domains', [StorefrontAdminController::class, 'storeDomain']);
        Route::patch('domains/{domain}', [StorefrontAdminController::class, 'updateDomain'])->whereUuid('domain');
        Route::delete('domains/{domain}', [StorefrontAdminController::class, 'destroyDomain'])->whereUuid('domain');
        Route::put('theme', [StorefrontAdminController::class, 'updateTheme']);
        Route::post('menus', [MenuController::class, 'store']);
        Route::patch('menus/{menu}', [MenuController::class, 'update'])->whereUuid('menu');
        Route::put('menus/{menu}/items', [MenuController::class, 'replaceItems'])->whereUuid('menu');
        Route::delete('menus/{menu}', [MenuController::class, 'destroy'])->whereUuid('menu');
    });

    Route::put('theme/custom-css', [StorefrontAdminController::class, 'updateCustomCss'])->middleware('can:storefront.custom_css');
});
