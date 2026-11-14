<?php

use App\Modules\Reviews\Presentation\Http\Controllers\AccountReviewController;
use App\Modules\Reviews\Presentation\Http\Controllers\QuestionModerationController;
use App\Modules\Reviews\Presentation\Http\Controllers\ReviewModerationController;
use App\Modules\Reviews\Presentation\Http\Controllers\StoreQuestionController;
use App\Modules\Reviews\Presentation\Http\Controllers\StoreReviewController;
use Illuminate\Support\Facades\Route;

// Public: approved reviews of a live product (organization from the host name).
Route::middleware(['storefront', 'throttle:storefront', 'storefront.cache'])->prefix('store')->group(function () {
    Route::get('products/{slug}/reviews', [StoreReviewController::class, 'index'])->where('slug', '[A-Za-z0-9-]{1,120}')->name('store.products.reviews');
    // P1b: answered questions of a live product.
    Route::get('products/{slug}/questions', [StoreQuestionController::class, 'index'])->where('slug', '[A-Za-z0-9-]{1,120}')->name('store.products.questions');
});

// P1b: a shopper asks a question (guests too; a signed-in shopper's account is linked; no caching).
Route::middleware(['storefront', 'storefront.session', 'throttle:storefront', 'customer.active:optional'])->prefix('store')->group(function () {
    Route::post('products/{slug}/questions', [StoreQuestionController::class, 'store'])->where('slug', '[A-Za-z0-9-]{1,120}')
        ->middleware(['throttle:storefront-write', 'throttle:product-questions']);
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
    // P1b: shoppers' questions.
    Route::get('questions', [QuestionModerationController::class, 'index'])->middleware('can:reviews.view');

    Route::middleware('can:reviews.moderate')->group(function () {
        Route::post('{review}/approve', [ReviewModerationController::class, 'approve'])->whereUuid('review');
        Route::post('{review}/reject', [ReviewModerationController::class, 'reject'])->whereUuid('review');
        Route::delete('{review}', [ReviewModerationController::class, 'destroy'])->whereUuid('review');
        // P1b
        Route::post('questions/{question}/answer', [QuestionModerationController::class, 'answer'])->whereUuid('question');
        Route::post('questions/{question}/reject', [QuestionModerationController::class, 'reject'])->whereUuid('question');
        Route::delete('questions/{question}', [QuestionModerationController::class, 'destroy'])->whereUuid('question');
    });
});
