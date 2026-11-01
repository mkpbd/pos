<?php

use App\Modules\Reviews\Presentation\Http\Controllers\AccountReviewController;
use App\Modules\Reviews\Presentation\Http\Controllers\ReviewModerationController;
use App\Modules\Reviews\Presentation\Http\Controllers\StoreReviewController;
use Illuminate\Support\Facades\Route;

// Public: approved reviews of a live product (organization from the host name).
Route::middleware(['storefront', 'throttle:storefront'])->prefix('store')->group(function () {
    Route::get('products/{slug}/reviews', [StoreReviewController::class, 'index'])->where('slug', '[A-Za-z0-9-]{1,120}')->name('store.products.reviews');
});

// The signed-in customer's own reviews.
Route::middleware(['storefront', 'storefront.session', 'throttle:storefront', 'auth:customer', 'customer.active'])->prefix('store/account/reviews')->group(function () {
    Route::get('/', [AccountReviewController::class, 'index'])->name('store.account.reviews');
    Route::post('/', [AccountReviewController::class, 'store'])->middleware(['throttle:storefront-write', 'throttle:reviews']);

    Route::middleware('throttle:storefront-write')->group(function () {
        Route::patch('{reviewId}', [AccountReviewController::class, 'update'])->whereUuid('reviewId');
        Route::delete('{reviewId}', [AccountReviewController::class, 'destroy'])->whereUuid('reviewId');
    });
});

// Staff moderation.
Route::prefix('reviews')->middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::get('/', [ReviewModerationController::class, 'index'])->middleware('can:reviews.view');

    Route::middleware('can:reviews.moderate')->group(function () {
        Route::post('{review}/approve', [ReviewModerationController::class, 'approve'])->whereUuid('review');
        Route::post('{review}/reject', [ReviewModerationController::class, 'reject'])->whereUuid('review');
        Route::delete('{review}', [ReviewModerationController::class, 'destroy'])->whereUuid('review');
    });
});
