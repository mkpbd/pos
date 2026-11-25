<?php

use App\Modules\StoredValue\Presentation\Http\Controllers\GiftCardController;
use App\Modules\StoredValue\Presentation\Http\Controllers\StoreCreditController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'tenant'])->group(function () {
    // §1 Store credit (customer advances).
    Route::prefix('customers/{customerId}/store-credit')->whereUuid('customerId')->group(function () {
        Route::get('/', [StoreCreditController::class, 'show'])->middleware('can:store_credit.view');
        Route::get('entries', [StoreCreditController::class, 'entries'])->middleware('can:store_credit.view');
        Route::post('top-ups', [StoreCreditController::class, 'topUp'])->middleware(['can:payments.collect', 'idempotent']);
        Route::post('withdrawals', [StoreCreditController::class, 'withdraw'])->middleware(['can:store_credit.manage', 'idempotent']);
        Route::post('adjustments', [StoreCreditController::class, 'adjust'])->middleware(['can:store_credit.manage', 'idempotent']);
    });

    // §2 Gift cards and vouchers.
    Route::prefix('gift-cards')->group(function () {
        Route::get('/', [GiftCardController::class, 'index'])->middleware('can:gift_cards.view');
        Route::post('sell', [GiftCardController::class, 'sell'])->middleware(['can:pos.sell', 'can:payments.collect', 'idempotent']);
        Route::post('vouchers', [GiftCardController::class, 'issueVoucher'])->middleware(['can:gift_cards.manage', 'idempotent']);
        Route::post('lookup', [GiftCardController::class, 'lookup'])->middleware(['can:pos.sell', 'throttle:gift-card-lookup']);
        Route::get('{giftCard}', [GiftCardController::class, 'show'])->whereUuid('giftCard')->middleware('can:gift_cards.view');
        Route::post('{giftCard}/void', [GiftCardController::class, 'void'])->whereUuid('giftCard')->middleware('can:gift_cards.manage');
    });
});
