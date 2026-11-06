<?php

use App\Modules\Inventory\Presentation\Http\Controllers\AdjustmentController;
use App\Modules\Inventory\Presentation\Http\Controllers\ReorderRuleController;
use App\Modules\Inventory\Presentation\Http\Controllers\ReplenishmentSettingsController;
use App\Modules\Inventory\Presentation\Http\Controllers\StockController;
use App\Modules\Inventory\Presentation\Http\Controllers\TransferController;
use Illuminate\Support\Facades\Route;

Route::prefix('inventory')->middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::get('stock', [StockController::class, 'index'])->middleware('can:inventory.view');
    Route::get('batches', [StockController::class, 'batches'])->middleware('can:inventory.view');
    Route::get('movements', [StockController::class, 'movements'])->middleware('can:inventory.view');
    Route::get('valuation', [StockController::class, 'valuation'])->middleware(['can:inventory.view', 'can:products.view_cost']);

    Route::get('adjustments', [AdjustmentController::class, 'index'])->middleware('can:inventory.view');
    Route::post('adjustments', [AdjustmentController::class, 'store'])->middleware('can:inventory.adjust');
    Route::get('adjustments/{adjustment}', [AdjustmentController::class, 'show'])->middleware('can:inventory.view');

    Route::get('transfers', [TransferController::class, 'index'])->middleware('can:inventory.view');
    Route::post('transfers', [TransferController::class, 'store'])->middleware('can:inventory.transfer');
    Route::get('transfers/{transfer}', [TransferController::class, 'show'])->middleware('can:inventory.view');
    Route::post('transfers/{transfer}/receive', [TransferController::class, 'receive'])->middleware('can:inventory.transfer');
    Route::post('transfers/{transfer}/cancel', [TransferController::class, 'cancel'])->middleware('can:inventory.transfer');

    // SC1: per-store reorder rules and replenishment settings.
    Route::get('reorder-rules', [ReorderRuleController::class, 'index'])->middleware('can:inventory.view');
    Route::put('reorder-rules', [ReorderRuleController::class, 'upsert'])->middleware('can:inventory.manage');
    Route::delete('reorder-rules/{reorderRule}', [ReorderRuleController::class, 'destroy'])->whereUuid('reorderRule')->middleware('can:inventory.manage');
    Route::get('replenishment-settings', [ReplenishmentSettingsController::class, 'show'])->middleware('can:inventory.view');
    Route::patch('replenishment-settings', [ReplenishmentSettingsController::class, 'update'])->middleware('can:inventory.manage');
});
