<?php

use App\Modules\Expenses\Presentation\Http\Controllers\ExpenseCategoryController;
use App\Modules\Expenses\Presentation\Http\Controllers\ExpenseController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::get('expense-categories', [ExpenseCategoryController::class, 'index'])->middleware('can:expenses.view');
    Route::post('expense-categories', [ExpenseCategoryController::class, 'store'])->middleware('can:expenses.manage');
    Route::put('expense-categories/{expenseCategory}', [ExpenseCategoryController::class, 'update'])->whereUuid('expenseCategory')->middleware('can:expenses.manage');
    Route::delete('expense-categories/{expenseCategory}', [ExpenseCategoryController::class, 'destroy'])->whereUuid('expenseCategory')->middleware('can:expenses.manage');

    Route::get('expenses', [ExpenseController::class, 'index'])->middleware('can:expenses.view');
    Route::post('expenses', [ExpenseController::class, 'store'])->middleware(['can:expenses.manage', 'idempotent']);
    Route::get('expenses/{expense}', [ExpenseController::class, 'show'])->whereUuid('expense')->middleware('can:expenses.view');
    Route::post('expenses/{expense}/void', [ExpenseController::class, 'void'])->whereUuid('expense')->middleware('can:expenses.manage');
});
