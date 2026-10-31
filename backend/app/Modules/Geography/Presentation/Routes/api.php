<?php

use App\Modules\Geography\Presentation\Http\Controllers\StoreGeoController;
use Illuminate\Support\Facades\Route;

// Public reference data for the storefront's address forms (no session needed).
Route::middleware(['storefront', 'throttle:storefront'])->prefix('store/geo')->group(function () {
    Route::get('divisions', [StoreGeoController::class, 'divisions'])->name('store.geo.divisions');
    Route::get('districts', [StoreGeoController::class, 'districts'])->name('store.geo.districts');
});

// The same lists for the admin (delivery zones, order addresses): any signed-in staff user.
Route::middleware(['auth:sanctum', 'tenant'])->prefix('geography')->group(function () {
    Route::get('divisions', [StoreGeoController::class, 'divisions']);
    Route::get('districts', [StoreGeoController::class, 'districts']);
});
