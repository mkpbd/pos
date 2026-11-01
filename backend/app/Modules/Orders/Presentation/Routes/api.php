<?php

use App\Modules\Orders\Presentation\Http\Controllers\AccountOrderController;
use App\Modules\Orders\Presentation\Http\Controllers\AccountReturnController;
use App\Modules\Orders\Presentation\Http\Controllers\CodRemittanceController;
use App\Modules\Orders\Presentation\Http\Controllers\StoreCheckoutController;
use App\Modules\Orders\Presentation\Http\Controllers\StoreOrderController;
use App\Modules\Orders\Presentation\Http\Controllers\WebOrderController;
use App\Modules\Orders\Presentation\Http\Controllers\WebOrderReturnController;
use Illuminate\Support\Facades\Route;

// Storefront checkout and order pages (guests and customers): organization from the host, cookie session + CSRF.
Route::middleware(['storefront', 'storefront.session', 'throttle:storefront', 'customer.active:optional'])->prefix('store')->group(function () {
    Route::get('checkout/options', [StoreCheckoutController::class, 'options'])->name('store.checkout.options');
    Route::post('checkout/preview', [StoreCheckoutController::class, 'preview'])->middleware('throttle:checkout')->name('store.checkout.preview');
    Route::post('checkout', [StoreCheckoutController::class, 'place'])->middleware(['throttle:checkout', 'idempotent:shopper'])->name('store.checkout');
    Route::get('orders/{number}', [StoreOrderController::class, 'show'])->where('number', '[A-Za-z0-9-]{1,40}')->name('store.orders.show');
});

// The signed-in customer's own orders (E9).
Route::middleware(['storefront', 'storefront.session', 'throttle:storefront', 'auth:customer', 'customer.active'])->prefix('store/account/orders')->group(function () {
    Route::get('/', [AccountOrderController::class, 'index'])->name('store.account.orders');
    Route::get('{number}', [AccountOrderController::class, 'show'])->where('number', '[A-Za-z0-9-]{1,40}')->name('store.account.orders.show');

    Route::middleware('throttle:storefront-write')->group(function () {
        Route::post('{number}/cancel', [AccountOrderController::class, 'cancel'])->where('number', '[A-Za-z0-9-]{1,40}')->middleware('idempotent:shopper');
        Route::post('{number}/reorder', [AccountOrderController::class, 'reorder'])->where('number', '[A-Za-z0-9-]{1,40}');
        // E10b: ask to return goods of a delivered order.
        Route::post('{number}/returns', [AccountReturnController::class, 'store'])->where('number', '[A-Za-z0-9-]{1,40}')->middleware('idempotent:shopper');
    });
});

// The signed-in customer's own returns (E10b).
Route::middleware(['storefront', 'storefront.session', 'throttle:storefront', 'auth:customer', 'customer.active'])->prefix('store/account/returns')->group(function () {
    Route::get('/', [AccountReturnController::class, 'index'])->name('store.account.returns');
    Route::post('{number}/cancel', [AccountReturnController::class, 'cancel'])->where('number', '[A-Za-z0-9-]{1,40}')
        ->middleware(['throttle:storefront-write', 'idempotent:shopper']);
});

// Staff: web orders.
Route::prefix('web-orders')->middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::middleware('can:web_orders.view')->group(function () {
        Route::get('/', [WebOrderController::class, 'index']);
        Route::get('print', [WebOrderController::class, 'print']);
        Route::get('{webOrder}', [WebOrderController::class, 'show'])->whereUuid('webOrder');
    });

    Route::middleware(['can:web_orders.manage', 'idempotent'])->group(function () {
        Route::post('{webOrder}/confirm-payment', [WebOrderController::class, 'confirmPayment'])->whereUuid('webOrder');
        Route::post('{webOrder}/process', [WebOrderController::class, 'process'])->whereUuid('webOrder');
        Route::post('bulk/process', [WebOrderController::class, 'bulkProcess']);
        Route::post('{webOrder}/ship', [WebOrderController::class, 'ship'])->whereUuid('webOrder');
        Route::post('{webOrder}/shipment/events', [WebOrderController::class, 'shipmentEvent'])->whereUuid('webOrder');
        Route::post('{webOrder}/deliver', [WebOrderController::class, 'deliver'])->whereUuid('webOrder');
        Route::post('{webOrder}/record-cod-payment', [WebOrderController::class, 'recordCodPayment'])->whereUuid('webOrder');
    });

    // Unpaid orders: web_orders.manage; paid orders with a refund (E11): web_orders.refund (checked by the controller).
    Route::post('{webOrder}/cancel', [WebOrderController::class, 'cancel'])->whereUuid('webOrder')->middleware('idempotent');

    // E10b: staff-created returns.
    Route::post('{webOrder}/returns', [WebOrderReturnController::class, 'store'])->whereUuid('webOrder')->middleware(['can:web_orders.refund', 'idempotent']);
});

// Staff: online returns and refunds (E10b).
Route::prefix('web-order-returns')->middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::middleware('can:web_orders.view')->group(function () {
        Route::get('/', [WebOrderReturnController::class, 'index']);
        Route::get('{orderReturn}', [WebOrderReturnController::class, 'show'])->whereUuid('orderReturn');
    });

    Route::middleware(['can:web_orders.refund', 'idempotent'])->group(function () {
        Route::post('{orderReturn}/approve', [WebOrderReturnController::class, 'approve'])->whereUuid('orderReturn');
        Route::post('{orderReturn}/reject', [WebOrderReturnController::class, 'reject'])->whereUuid('orderReturn');
        Route::post('{orderReturn}/receive', [WebOrderReturnController::class, 'receive'])->whereUuid('orderReturn');
        Route::post('{orderReturn}/refund', [WebOrderReturnController::class, 'refund'])->whereUuid('orderReturn');
    });
});

// Staff: couriers' cash-on-delivery remittances (E10a).
Route::prefix('cod-remittances')->middleware(['auth:sanctum', 'tenant', 'can:web_orders.remit'])->group(function () {
    Route::get('/', [CodRemittanceController::class, 'index']);
    Route::get('{codRemittance}', [CodRemittanceController::class, 'show'])->whereUuid('codRemittance');
    Route::post('/', [CodRemittanceController::class, 'store'])->middleware('idempotent');
});
