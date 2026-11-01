<?php

use App\Modules\Promotions\Presentation\Http\Controllers\CouponController;
use App\Modules\Promotions\Presentation\Http\Controllers\PromotionController;
use Illuminate\Support\Facades\Route;

// Staff: promotions and their coupon codes (the storefront applies coupons through the cart).
Route::middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::prefix('promotions')->group(function () {
        Route::middleware('can:promotions.view')->group(function () {
            Route::get('/', [PromotionController::class, 'index']);
            Route::get('{promotion}', [PromotionController::class, 'show'])->whereUuid('promotion');
            Route::get('{promotion}/coupons', [CouponController::class, 'index'])->whereUuid('promotion');
            Route::get('{promotion}/redemptions', [PromotionController::class, 'redemptions'])->whereUuid('promotion');
            Route::get('{promotion}/report', [PromotionController::class, 'report'])->whereUuid('promotion');
        });

        Route::middleware('can:promotions.manage')->group(function () {
            Route::post('/', [PromotionController::class, 'store']);
            Route::patch('{promotion}', [PromotionController::class, 'update'])->whereUuid('promotion');
            Route::delete('{promotion}', [PromotionController::class, 'destroy'])->whereUuid('promotion');
            Route::post('{promotion}/coupons', [CouponController::class, 'store'])->whereUuid('promotion');
        });
    });

    Route::prefix('coupons')->middleware('can:promotions.manage')->group(function () {
        Route::patch('{coupon}', [CouponController::class, 'update'])->whereUuid('coupon');
        Route::delete('{coupon}', [CouponController::class, 'destroy'])->whereUuid('coupon');
    });
});
