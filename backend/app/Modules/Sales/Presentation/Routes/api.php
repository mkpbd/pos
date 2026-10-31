<?php

use App\Modules\Sales\Presentation\Http\Controllers\SaleController;
use Illuminate\Support\Facades\Route;

Route::prefix('sales')->middleware(['auth:sanctum', 'tenant'])->group(function () {
    // History and invoices: `sales.view`, or `pos.sell` for one's own sales (checked in the presenter).
    Route::get('/', [SaleController::class, 'index']);
    Route::get('summary', [SaleController::class, 'summary'])->middleware('can:sales.view');
    Route::get('customer-balances', [SaleController::class, 'customerBalances'])->middleware('can:sales.view');
    Route::get('{sale}', [SaleController::class, 'show'])->whereUuid('sale');
    Route::post('{sale}/cancel', [SaleController::class, 'cancel'])->whereUuid('sale')->middleware('can:sales.cancel');
});
