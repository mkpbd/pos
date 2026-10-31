<?php

use App\Modules\OnlinePayments\Presentation\Http\Controllers\PaymentGatewayController;
use Illuminate\Support\Facades\Route;

// Staff: payment methods of the online store (Organization Admin by default, ADR-016).
Route::prefix('payment-gateways')->middleware(['auth:sanctum', 'tenant', 'can:payment_gateways.manage'])->group(function () {
    Route::get('/', [PaymentGatewayController::class, 'index']);
    Route::put('{code}', [PaymentGatewayController::class, 'update'])->where('code', '[a-z_]{1,30}');
});
