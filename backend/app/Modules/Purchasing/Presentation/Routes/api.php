<?php

use App\Modules\Purchasing\Presentation\Http\Controllers\GoodsReceiptController;
use App\Modules\Purchasing\Presentation\Http\Controllers\PurchaseOrderController;
use App\Modules\Purchasing\Presentation\Http\Controllers\SupplierPaymentController;
use Illuminate\Support\Facades\Route;

Route::prefix('purchasing')->middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::get('orders', [PurchaseOrderController::class, 'index'])->middleware('can:purchases.view');
    Route::post('orders', [PurchaseOrderController::class, 'store'])->middleware('can:purchases.manage');
    Route::get('orders/{order}', [PurchaseOrderController::class, 'show'])->middleware('can:purchases.view');
    Route::put('orders/{order}', [PurchaseOrderController::class, 'update'])->middleware('can:purchases.manage');
    Route::post('orders/{order}/place', [PurchaseOrderController::class, 'place'])->middleware('can:purchases.manage');
    Route::post('orders/{order}/cancel', [PurchaseOrderController::class, 'cancel'])->middleware('can:purchases.manage');

    Route::get('receipts', [GoodsReceiptController::class, 'index'])->middleware('can:purchases.view');
    Route::post('receipts', [GoodsReceiptController::class, 'store'])->middleware('can:purchases.receive');
    Route::get('receipts/{receipt}', [GoodsReceiptController::class, 'show'])->middleware('can:purchases.view');
    Route::post('receipts/{receipt}/returns', [GoodsReceiptController::class, 'storeReturn'])->middleware('can:purchases.return');

    Route::get('returns', [GoodsReceiptController::class, 'returns'])->middleware('can:purchases.view');
    Route::get('returns/{purchaseReturn}', [GoodsReceiptController::class, 'showReturn'])->middleware('can:purchases.view');

    Route::get('payments', [SupplierPaymentController::class, 'index'])->middleware('can:purchases.view');
    Route::post('payments', [SupplierPaymentController::class, 'store'])->middleware('can:purchases.pay');
    Route::get('supplier-balances', [SupplierPaymentController::class, 'balances'])->middleware('can:purchases.view');
    Route::get('suppliers/{supplierId}/statement', [SupplierPaymentController::class, 'statement'])->whereUuid('supplierId')->middleware('can:purchases.view');
});
