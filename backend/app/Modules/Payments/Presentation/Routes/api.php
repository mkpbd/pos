<?php

use App\Modules\Payments\Presentation\Http\Controllers\CashRegisterController;
use App\Modules\Payments\Presentation\Http\Controllers\PaymentController;
use App\Modules\Payments\Presentation\Http\Controllers\RegisterSessionController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'tenant'])->group(function () {
    // Listing needs any cash register permission (checked in the controller).
    Route::get('cash-registers', [CashRegisterController::class, 'index']);
    Route::post('cash-registers', [CashRegisterController::class, 'store'])->middleware('can:cash_registers.manage');
    Route::put('cash-registers/{cashRegister}', [CashRegisterController::class, 'update'])->whereUuid('cashRegister')->middleware('can:cash_registers.manage');
    Route::post('cash-registers/{cashRegister}/sessions', [RegisterSessionController::class, 'open'])->whereUuid('cashRegister')->middleware('can:cash_registers.operate');

    // Visibility (all of the branch vs. one's own) is decided by the presenter.
    Route::get('register-sessions', [RegisterSessionController::class, 'index']);
    Route::get('register-sessions/current', [RegisterSessionController::class, 'current'])->middleware('can:cash_registers.operate');
    Route::get('register-sessions/{registerSession}', [RegisterSessionController::class, 'show'])->whereUuid('registerSession');
    Route::post('register-sessions/{registerSession}/cash-movements', [RegisterSessionController::class, 'cashMovement'])->whereUuid('registerSession')->middleware(['can:cash_registers.operate', 'idempotent']);
    // Own session with `cash_registers.operate`, anyone's with `cash_registers.manage` (checked in the action).
    Route::post('register-sessions/{registerSession}/close', [RegisterSessionController::class, 'close'])->whereUuid('registerSession');

    Route::get('payments', [PaymentController::class, 'index'])->middleware('can:payments.view');
});
