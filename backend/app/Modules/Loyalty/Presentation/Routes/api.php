<?php

use App\Modules\Loyalty\Presentation\Http\Controllers\LoyaltyController;
use Illuminate\Support\Facades\Route;

Route::prefix('loyalty')->middleware(['auth:sanctum', 'tenant'])->group(function () {
    // Reads: loyalty.*, customers.view or pos.sell (checked in the controller).
    Route::get('settings', [LoyaltyController::class, 'settings']);
    Route::put('settings', [LoyaltyController::class, 'updateSettings'])->middleware('can:loyalty.manage');
    Route::get('balances', [LoyaltyController::class, 'balances']);
    Route::get('customers/{customerId}', [LoyaltyController::class, 'customer'])->whereUuid('customerId');
    Route::post('customers/{customerId}/adjust', [LoyaltyController::class, 'adjust'])->whereUuid('customerId')->middleware('can:loyalty.manage');
});
