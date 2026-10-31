<?php

use App\Modules\Suppliers\Presentation\Http\Controllers\SupplierController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::get('suppliers', [SupplierController::class, 'index'])->middleware('can:suppliers.view');
    Route::post('suppliers', [SupplierController::class, 'store'])->middleware('can:suppliers.manage');
    Route::get('suppliers/{supplier}', [SupplierController::class, 'show'])->middleware('can:suppliers.view');
    Route::patch('suppliers/{supplier}', [SupplierController::class, 'update'])->middleware('can:suppliers.manage');
    Route::delete('suppliers/{supplier}', [SupplierController::class, 'destroy'])->middleware('can:suppliers.manage');
    Route::post('suppliers/{supplierId}/restore', [SupplierController::class, 'restore'])->whereUuid('supplierId')->middleware('can:suppliers.manage');
});
