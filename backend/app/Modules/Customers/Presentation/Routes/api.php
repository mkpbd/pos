<?php

use App\Modules\Customers\Presentation\Http\Controllers\CustomerController;
use App\Modules\Customers\Presentation\Http\Controllers\CustomerGroupController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::get('customer-groups', [CustomerGroupController::class, 'index'])->middleware('can:customers.view');
    Route::post('customer-groups', [CustomerGroupController::class, 'store'])->middleware('can:customers.manage');
    Route::patch('customer-groups/{customerGroup}', [CustomerGroupController::class, 'update'])->middleware('can:customers.manage');
    Route::delete('customer-groups/{customerGroup}', [CustomerGroupController::class, 'destroy'])->middleware('can:customers.manage');

    Route::get('customers', [CustomerController::class, 'index'])->middleware('can:customers.view');
    Route::post('customers', [CustomerController::class, 'store'])->middleware('can:customers.create');
    Route::get('customers/{customer}', [CustomerController::class, 'show'])->middleware('can:customers.view');
    Route::patch('customers/{customer}', [CustomerController::class, 'update'])->middleware('can:customers.manage');
    Route::delete('customers/{customer}', [CustomerController::class, 'destroy'])->middleware('can:customers.manage');
    Route::post('customers/{customerId}/restore', [CustomerController::class, 'restore'])->whereUuid('customerId')->middleware('can:customers.manage');
});
