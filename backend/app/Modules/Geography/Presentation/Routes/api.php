<?php

use App\Modules\Geography\Presentation\Http\Controllers\StoreGeoController;
use Illuminate\Support\Facades\Route;

// Public reference data for the storefront's address forms (no session needed).
Route::middleware(['storefront', 'throttle:storefront'])->prefix('store/geo')->group(function () {
    Route::get('divisions', [StoreGeoController::class, 'divisions'])->name('store.geo.divisions');
    Route::get('districts', [StoreGeoController::class, 'districts'])->name('store.geo.districts');
});
