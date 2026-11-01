<?php

namespace App\Modules\Expenses;

use App\Modules\Expenses\Application\Actions\RecordSystemExpense;
use App\Modules\Expenses\Application\Contracts\ExpenseRecorder;
use App\Modules\Expenses\Infrastructure\Models\Expense;
use App\Modules\Expenses\Infrastructure\Models\ExpenseCategory;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Support\Facades\Route;

/**
 * Expenses and other income with their categories. Every entry moves money through the
 * payments ledger (Payments module); voiding books the opposite payment. Other modules record
 * the expenses their documents cause through `ExpenseRecorder` (E10a: courier fees).
 */
class ExpensesServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(ExpenseRecorder::class, RecordSystemExpense::class);
    }

    public function boot(): void
    {
        Route::model('expense', Expense::class);
        Route::model('expenseCategory', ExpenseCategory::class);

        parent::boot();
    }

    protected function permissions(): array
    {
        return [
            'expenses.view' => 'View expenses and other income of accessible branches',
            'expenses.manage' => 'Record and void expenses and other income, manage their categories',
        ];
    }
}
