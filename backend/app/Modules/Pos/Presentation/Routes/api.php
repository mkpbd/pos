<?php

use App\Modules\Pos\Presentation\Http\Controllers\ApprovalController;
use App\Modules\Pos\Presentation\Http\Controllers\ExchangeController;
use App\Modules\Pos\Presentation\Http\Controllers\HeldSaleController;
use App\Modules\Pos\Presentation\Http\Controllers\PosController;
use App\Modules\Pos\Presentation\Http\Controllers\TerminalController;
use Illuminate\Support\Facades\Route;

Route::prefix('pos')->middleware(['auth:sanctum', 'tenant', 'can:pos.sell'])->group(function () {
    Route::get('catalog', [PosController::class, 'catalog']);
    Route::get('lookup', [PosController::class, 'lookup']);
    Route::post('price', [PosController::class, 'price']);
    Route::post('checkout', [PosController::class, 'checkout'])->middleware('idempotent');
    // POS1c: exchanges at the till.
    Route::post('exchanges', [ExchangeController::class, 'store'])->middleware(['can:returns.create', 'idempotent']);

    Route::get('held', [HeldSaleController::class, 'index']);
    Route::post('held', [HeldSaleController::class, 'store']);
    Route::get('held/{heldSale}', [HeldSaleController::class, 'show'])->whereUuid('heldSale');
    Route::delete('held/{heldSale}', [HeldSaleController::class, 'destroy'])->whereUuid('heldSale');

    // POS1a: manager approval by PIN.
    Route::get('approvers', [ApprovalController::class, 'approvers']);
    Route::post('approvals', [ApprovalController::class, 'store'])->middleware('throttle:pos-approval');
});

// POS1a: tills (devices set up for PIN sign-in).
Route::prefix('pos')->middleware(['auth:sanctum', 'tenant', 'can:pos.terminals.manage'])->group(function () {
    Route::get('terminals', [TerminalController::class, 'index']);
    Route::post('terminals', [TerminalController::class, 'store']);
    Route::delete('terminals/{terminal}', [TerminalController::class, 'destroy']);
});

// POS1a: this device's till and who can sign in at it (no sign-in needed; the till cookie).
Route::get('pos/terminal', [TerminalController::class, 'current'])->middleware('throttle:pos-terminal');
