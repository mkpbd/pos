<?php

use App\Modules\Sales\Presentation\Http\Controllers\CustomerPaymentController;
use App\Modules\Sales\Presentation\Http\Controllers\PublicReceiptController;
use App\Modules\Sales\Presentation\Http\Controllers\ReturnReasonController;
use App\Modules\Sales\Presentation\Http\Controllers\SaleController;
use App\Modules\Sales\Presentation\Http\Controllers\SaleReceiptController;
use App\Modules\Sales\Presentation\Http\Controllers\SaleReturnController;
use Illuminate\Support\Facades\Route;

Route::prefix('sales')->middleware(['auth:sanctum', 'tenant'])->group(function () {
    // History and invoices: `sales.view`, or `pos.sell` for one's own sales (checked in the presenter).
    Route::get('/', [SaleController::class, 'index']);
    Route::get('summary', [SaleController::class, 'summary'])->middleware('can:sales.view');
    Route::get('customer-balances', [SaleController::class, 'customerBalances'])->middleware('can:sales.view');
    Route::get('{sale}', [SaleController::class, 'show'])->whereUuid('sale');
    Route::post('{sale}/cancel', [SaleController::class, 'cancel'])->whereUuid('sale')->middleware('can:sales.cancel');
    // POS1d: digital receipts — the public link, and sending it by SMS / e-mail.
    Route::get('{sale}/receipt-link', [SaleReceiptController::class, 'link'])->whereUuid('sale')->middleware('can:sales.view');
    Route::post('{sale}/receipt/send', [SaleReceiptController::class, 'send'])->whereUuid('sale')
        ->middleware(['can:sales.view', 'can:pos.sell', 'throttle:receipt-send']);
});

// POS1d: the public digital receipt (organization from the store's host, no sign-in).
Route::middleware(['storefront', 'throttle:storefront', 'throttle:receipt-view'])->prefix('store')->group(function () {
    Route::get('receipts/{token}', [PublicReceiptController::class, 'show'])->where('token', '[A-Za-z0-9_-]{1,64}')->name('store.receipts.show');
});

Route::prefix('returns')->middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::get('/', [SaleReturnController::class, 'index'])->middleware('can:returns.view');
    Route::post('preview', [SaleReturnController::class, 'preview'])->middleware('can:returns.create');
    Route::post('/', [SaleReturnController::class, 'store'])->middleware(['can:returns.create', 'idempotent']);
    Route::get('{saleReturn}', [SaleReturnController::class, 'show'])->whereUuid('saleReturn')->middleware('can:returns.view');
    Route::post('{saleReturn}/approve', [SaleReturnController::class, 'approve'])->whereUuid('saleReturn')->middleware(['can:returns.approve', 'idempotent']);
    Route::post('{saleReturn}/reject', [SaleReturnController::class, 'reject'])->whereUuid('saleReturn')->middleware('can:returns.approve');
});

Route::prefix('return-reasons')->middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::get('/', [ReturnReasonController::class, 'index']);
    Route::post('/', [ReturnReasonController::class, 'store'])->middleware('can:returns.manage');
    Route::put('{returnReason}', [ReturnReasonController::class, 'update'])->whereUuid('returnReason')->middleware('can:returns.manage');
    Route::delete('{returnReason}', [ReturnReasonController::class, 'destroy'])->whereUuid('returnReason')->middleware('can:returns.manage');
});

Route::middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::get('customer-payments', [CustomerPaymentController::class, 'index'])->middleware('can:payments.view');
    Route::post('customer-payments', [CustomerPaymentController::class, 'store'])->middleware(['can:payments.collect', 'idempotent']);
    Route::get('customers/{customerId}/statement', [CustomerPaymentController::class, 'statement'])->whereUuid('customerId');
});
