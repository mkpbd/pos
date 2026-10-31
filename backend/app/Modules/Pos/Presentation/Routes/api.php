<?php

use App\Modules\Pos\Presentation\Http\Controllers\HeldSaleController;
use App\Modules\Pos\Presentation\Http\Controllers\PosController;
use Illuminate\Support\Facades\Route;

Route::prefix('pos')->middleware(['auth:sanctum', 'tenant', 'can:pos.sell'])->group(function () {
    Route::get('catalog', [PosController::class, 'catalog']);
    Route::get('lookup', [PosController::class, 'lookup']);
    Route::post('price', [PosController::class, 'price']);
    Route::post('checkout', [PosController::class, 'checkout'])->middleware('idempotent');

    Route::get('held', [HeldSaleController::class, 'index']);
    Route::post('held', [HeldSaleController::class, 'store']);
    Route::get('held/{heldSale}', [HeldSaleController::class, 'show'])->whereUuid('heldSale');
    Route::delete('held/{heldSale}', [HeldSaleController::class, 'destroy'])->whereUuid('heldSale');
});
