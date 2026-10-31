<?php

namespace App\Modules\Sales;

use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Support\Facades\Route;

/**
 * Sale invoices (immutable), pricing with discounts and tax, payments of a sale,
 * cancellation, sales history and the daily summary. The POS module drives checkout.
 */
class SalesServiceProvider extends ModuleServiceProvider
{
    public function boot(): void
    {
        Route::model('sale', Sale::class);

        parent::boot();
    }

    protected function permissions(): array
    {
        return [
            'sales.view' => 'View sales history, invoices and the daily sales summary of accessible branches',
            'sales.discount' => 'Give manual item and invoice discounts at the till (within product limits)',
            'sales.credit' => 'Sell on credit: leave an amount due on a customer account (within the credit limit)',
            'sales.cancel' => 'Cancel completed sales (restocks goods and reverses payments)',
        ];
    }
}
