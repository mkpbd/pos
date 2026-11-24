<?php

use App\Modules\Orders\Presentation\Http\Controllers\AccountOrderController;
use App\Modules\Orders\Presentation\Http\Controllers\AccountReturnController;
use App\Modules\Orders\Presentation\Http\Controllers\BlockedPhoneController;
use App\Modules\Orders\Presentation\Http\Controllers\CodRemittanceController;
use App\Modules\Orders\Presentation\Http\Controllers\StaffOrderController;
use App\Modules\Orders\Presentation\Http\Controllers\StoreCheckoutController;
use App\Modules\Orders\Presentation\Http\Controllers\StoreCheckoutPhoneController;
use App\Modules\Orders\Presentation\Http\Controllers\StoreDirectCheckoutController;
use App\Modules\Orders\Presentation\Http\Controllers\StoreOrderController;
use App\Modules\Orders\Presentation\Http\Controllers\StorePaymentClaimController;
use App\Modules\Orders\Presentation\Http\Controllers\WebOrderController;
use App\Modules\Orders\Presentation\Http\Controllers\WebOrderPaymentClaimController;
use App\Modules\Orders\Presentation\Http\Controllers\WebOrderReturnController;
use Illuminate\Support\Facades\Route;

// Storefront checkout and order pages (guests and customers): organization from the host, cookie session + CSRF.
Route::middleware(['storefront', 'storefront.session', 'throttle:storefront', 'customer.active:optional'])->prefix('store')->group(function () {
    Route::get('checkout/options', [StoreCheckoutController::class, 'options'])->name('store.checkout.options');
    Route::post('checkout/preview', [StoreCheckoutController::class, 'preview'])->middleware('throttle:checkout')->name('store.checkout.preview');
    Route::post('checkout', [StoreCheckoutController::class, 'place'])->middleware(['throttle:checkout', 'idempotent:shopper'])->name('store.checkout');
    // P2a: a landing page's order form orders directly, without the cart.
    Route::post('checkout/direct/preview', [StoreDirectCheckoutController::class, 'preview'])->middleware('throttle:checkout')->name('store.checkout.direct.preview');
    Route::post('checkout/direct', [StoreDirectCheckoutController::class, 'place'])->middleware(['throttle:checkout', 'idempotent:visitor'])->name('store.checkout.direct');
    // BD1a: checking the mobile number with an SMS code before placing an order.
    Route::post('checkout/phone/send', [StoreCheckoutPhoneController::class, 'send'])->middleware('throttle:checkout')->name('store.checkout.phone.send');
    Route::post('checkout/phone/verify', [StoreCheckoutPhoneController::class, 'verify'])->middleware('throttle:checkout')->name('store.checkout.phone.verify');
    // BD1a: track an order with its number and mobile number (before orders/{number}).
    Route::get('orders/track', [StoreOrderController::class, 'track'])->middleware('throttle:order-track')->name('store.orders.track');
    Route::get('orders/{number}', [StoreOrderController::class, 'show'])->where('number', '[A-Za-z0-9-]{1,40}')->name('store.orders.show');
    // BD1c: the shopper reports a Send Money payment (guests keep no cart after checkout: visitor-scoped idempotency).
    Route::post('orders/{number}/payment-claims', [StorePaymentClaimController::class, 'store'])->where('number', '[A-Za-z0-9-]{1,40}')
        ->middleware(['throttle:storefront-write', 'idempotent:visitor'])->name('store.orders.payment-claims');
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
    // BD1b: blocked numbers and a number's delivery history (before the {webOrder} routes).
    Route::get('blocked-phones', [BlockedPhoneController::class, 'index'])->middleware('can:web_orders.view');
    Route::post('blocked-phones', [BlockedPhoneController::class, 'store'])->middleware('can:web_orders.manage');
    Route::delete('blocked-phones/{blockedPhone}', [BlockedPhoneController::class, 'destroy'])->whereUuid('blockedPhone')->middleware('can:web_orders.manage');
    Route::get('phone-report', [BlockedPhoneController::class, 'phoneReport'])->middleware('can:web_orders.view');

    // BD1b: orders staff enter and changes before shipping (quote: web_orders.create or .edit, checked by the controller).
    Route::post('quote', [StaffOrderController::class, 'quote']);
    Route::post('/', [StaffOrderController::class, 'store'])->middleware(['can:web_orders.create', 'idempotent']);
    Route::put('{webOrder}', [StaffOrderController::class, 'update'])->whereUuid('webOrder')->middleware(['can:web_orders.edit', 'idempotent']);

    Route::middleware('can:web_orders.view')->group(function () {
        Route::get('/', [WebOrderController::class, 'index']);
        Route::get('print', [WebOrderController::class, 'print']);
        Route::get('{webOrder}', [WebOrderController::class, 'show'])->whereUuid('webOrder');
    });

    Route::middleware(['can:web_orders.manage', 'idempotent'])->group(function () {
        Route::post('{webOrder}/confirm-payment', [WebOrderController::class, 'confirmPayment'])->whereUuid('webOrder');
        Route::post('{webOrder}/process', [WebOrderController::class, 'process'])->whereUuid('webOrder');
        Route::post('bulk/process', [WebOrderController::class, 'bulkProcess']);
        // BD1b: cash-on-delivery orders held for a confirmation call.
        Route::post('{webOrder}/confirm', [WebOrderController::class, 'confirm'])->whereUuid('webOrder');
        Route::post('bulk/confirm', [WebOrderController::class, 'bulkConfirm']);
        Route::post('{webOrder}/ship', [WebOrderController::class, 'ship'])->whereUuid('webOrder');
        Route::post('{webOrder}/shipment/events', [WebOrderController::class, 'shipmentEvent'])->whereUuid('webOrder');
        Route::post('{webOrder}/deliver', [WebOrderController::class, 'deliver'])->whereUuid('webOrder');
        Route::post('{webOrder}/record-cod-payment', [WebOrderController::class, 'recordCodPayment'])->whereUuid('webOrder');
        // BD1c: the shopper's Send Money payment claims.
        Route::post('{webOrder}/payment-claims/{claim}/confirm', [WebOrderPaymentClaimController::class, 'confirm'])->whereUuid(['webOrder', 'claim']);
        Route::post('{webOrder}/payment-claims/{claim}/reject', [WebOrderPaymentClaimController::class, 'reject'])->whereUuid(['webOrder', 'claim']);
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
