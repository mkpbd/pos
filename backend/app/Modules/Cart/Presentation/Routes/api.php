<?php

use App\Modules\Cart\Presentation\Http\Controllers\CartController;
use App\Modules\Cart\Presentation\Http\Controllers\WishlistController;
use Illuminate\Support\Facades\Route;

// Cart (guests and customers) and wishlist (customers): organization from the host name, cookie session + CSRF.
Route::middleware(['storefront', 'storefront.session', 'throttle:storefront', 'customer.active:optional'])->prefix('store')->group(function () {
    Route::get('cart', [CartController::class, 'show'])->name('store.cart');

    Route::middleware('throttle:storefront-write')->group(function () {
        Route::post('cart/items', [CartController::class, 'store'])->name('store.cart.add');
        Route::patch('cart/items/{itemId}', [CartController::class, 'update'])->whereUuid('itemId');
        Route::delete('cart/items/{itemId}', [CartController::class, 'destroy'])->whereUuid('itemId');
        Route::delete('cart', [CartController::class, 'clear']);
    });

    Route::middleware(['auth:customer', 'customer.active'])->prefix('wishlist')->group(function () {
        Route::get('/', [WishlistController::class, 'show'])->name('store.wishlist');

        Route::middleware('throttle:storefront-write')->group(function () {
            Route::post('items', [WishlistController::class, 'store']);
            Route::delete('items/{itemId}', [WishlistController::class, 'destroy'])->whereUuid('itemId');
            Route::post('merge', [WishlistController::class, 'merge']);
        });
    });
});
