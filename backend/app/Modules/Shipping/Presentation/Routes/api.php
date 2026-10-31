<?php

use App\Modules\Shipping\Presentation\Http\Controllers\ShippingZoneController;
use App\Modules\Shipping\Presentation\Http\Controllers\StoreShippingController;
use Illuminate\Support\Facades\Route;

// Staff: delivery zones and methods (reading also with web_orders.view, checked in the controller).
Route::prefix('shipping')->middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::get('zones', [ShippingZoneController::class, 'index']);

    Route::middleware('can:shipping.manage')->group(function () {
        Route::post('zones', [ShippingZoneController::class, 'store']);
        Route::patch('zones/{zone}', [ShippingZoneController::class, 'update'])->whereUuid('zone');
        Route::delete('zones/{zone}', [ShippingZoneController::class, 'destroy'])->whereUuid('zone');
        Route::post('zones/{zone}/methods', [ShippingZoneController::class, 'storeMethod'])->whereUuid('zone');
        Route::patch('methods/{method}', [ShippingZoneController::class, 'updateMethod'])->whereUuid('method');
        Route::delete('methods/{method}', [ShippingZoneController::class, 'destroyMethod'])->whereUuid('method');
    });
});

// Storefront: delivery methods for the shopper's district.
Route::middleware(['storefront', 'throttle:storefront'])->prefix('store')->group(function () {
    Route::get('shipping-methods', StoreShippingController::class)->name('store.shipping-methods');
});
