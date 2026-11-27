<?php

use App\Modules\Shipping\Presentation\Http\Controllers\CourierController;
use App\Modules\Shipping\Presentation\Http\Controllers\ShippingAreaController;
use App\Modules\Shipping\Presentation\Http\Controllers\ShippingZoneController;
use App\Modules\Shipping\Presentation\Http\Controllers\StoreShippingAreaController;
use App\Modules\Shipping\Presentation\Http\Controllers\StoreShippingController;
use Illuminate\Support\Facades\Route;

// Staff: delivery zones, methods and couriers (reading also with web_orders.view, checked in the controller).
Route::prefix('shipping')->middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::get('zones', [ShippingZoneController::class, 'index']);
    Route::get('couriers', [CourierController::class, 'index']);
    Route::get('areas', [ShippingAreaController::class, 'index']);

    Route::middleware('can:shipping.manage')->group(function () {
        Route::post('zones', [ShippingZoneController::class, 'store']);
        Route::patch('zones/{zone}', [ShippingZoneController::class, 'update'])->whereUuid('zone');
        Route::delete('zones/{zone}', [ShippingZoneController::class, 'destroy'])->whereUuid('zone');
        Route::post('zones/{zone}/methods', [ShippingZoneController::class, 'storeMethod'])->whereUuid('zone');
        Route::patch('methods/{method}', [ShippingZoneController::class, 'updateMethod'])->whereUuid('method');
        Route::delete('methods/{method}', [ShippingZoneController::class, 'destroyMethod'])->whereUuid('method');
        Route::post('areas', [ShippingAreaController::class, 'store']);
        Route::patch('areas/{area}', [ShippingAreaController::class, 'update'])->whereUuid('area');
        Route::delete('areas/{area}', [ShippingAreaController::class, 'destroy'])->whereUuid('area');
        Route::post('couriers', [CourierController::class, 'store']);
        Route::patch('couriers/{courier}', [CourierController::class, 'update'])->whereUuid('courier');
        Route::delete('couriers/{courier}', [CourierController::class, 'destroy'])->whereUuid('courier');
    });
});

// Storefront: delivery methods for the shopper's district (BD2a: priced for the shopper's cart, so with its session).
Route::middleware(['storefront', 'storefront.session', 'throttle:storefront', 'customer.active:optional'])->prefix('store')->group(function () {
    Route::get('shipping-methods', StoreShippingController::class)->name('store.shipping-methods');
});

Route::middleware(['storefront', 'throttle:storefront'])->prefix('store')->group(function () {
    // BD2a: the delivery areas of a district ([{id, name}]).
    Route::get('shipping/areas', StoreShippingAreaController::class)->name('store.shipping-areas');
});
