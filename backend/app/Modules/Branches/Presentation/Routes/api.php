<?php

use App\Modules\Branches\Presentation\Http\Controllers\BranchController;
use App\Modules\Branches\Presentation\Http\Controllers\StoreController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::get('branches', [BranchController::class, 'index'])->middleware('can:branches.view');
    Route::post('branches', [BranchController::class, 'store'])->middleware('can:branches.manage');
    Route::get('branches/{branch}', [BranchController::class, 'show'])->middleware('can:branches.view');
    Route::patch('branches/{branch}', [BranchController::class, 'update'])->middleware('can:branches.manage');

    // Stores are always addressed through their branch; scopeBindings() rejects a store of another branch.
    Route::scopeBindings()->group(function () {
        Route::get('branches/{branch}/stores', [StoreController::class, 'index'])->middleware('can:branches.view');
        Route::post('branches/{branch}/stores', [StoreController::class, 'store'])->middleware('can:branches.manage');
        Route::patch('branches/{branch}/stores/{store}', [StoreController::class, 'update'])->middleware('can:branches.manage');
    });
});
