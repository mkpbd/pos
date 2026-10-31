<?php

namespace App\Modules\Payments;

use App\Modules\Payments\Application\Contracts\PaymentLedger;
use App\Modules\Payments\Infrastructure\Ledger\EloquentPaymentLedger;
use App\Modules\Payments\Infrastructure\Models\CashRegister;
use App\Modules\Payments\Infrastructure\Models\RegisterSession;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Support\Facades\Route;

/**
 * The payments ledger (every amount received or paid out, by any module) and the cash
 * registers it runs through: registers, sessions (shifts) with opening float, cash in/out,
 * closing count and variance.
 */
class PaymentsServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(PaymentLedger::class, EloquentPaymentLedger::class);
    }

    public function boot(): void
    {
        Route::model('cashRegister', CashRegister::class);
        Route::model('registerSession', RegisterSession::class);

        parent::boot();
    }

    protected function permissions(): array
    {
        return [
            'payments.view' => 'View the payments ledger (all money received and paid out) of accessible branches',
            'cash_registers.view' => 'View every register session and its report in accessible branches',
            'cash_registers.operate' => 'Open and close one\'s own register session, record cash in and out',
            'cash_registers.manage' => 'Create and edit registers, close anyone\'s session',
        ];
    }
}
