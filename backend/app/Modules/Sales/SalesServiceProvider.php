<?php

namespace App\Modules\Sales;

use App\Modules\Sales\Application\Contracts\LoyaltyProgram;
use App\Modules\Sales\Application\Services\NoLoyaltyProgram;
use App\Modules\Sales\Infrastructure\Models\ReturnReason;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SaleReturn;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Support\Facades\Route;

/**
 * Sale invoices (immutable), pricing with discounts and tax, payments of a sale,
 * cancellation, returns with approval and refunds, customer payments and statements
 * (accounts receivable), sales history and the daily summary. The POS module drives checkout.
 */
class SalesServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        // Replaced by the Loyalty module when it is installed.
        $this->app->bindIf(LoyaltyProgram::class, NoLoyaltyProgram::class);
    }

    public function boot(): void
    {
        Route::model('sale', Sale::class);
        Route::model('saleReturn', SaleReturn::class);
        Route::model('returnReason', ReturnReason::class);

        parent::boot();
    }

    protected function permissions(): array
    {
        return [
            'sales.view' => 'View sales history, invoices and the daily sales summary of accessible branches',
            'sales.discount' => 'Give manual item and invoice discounts at the till (within product limits)',
            'sales.credit' => 'Sell on credit: leave an amount due on a customer account (within the credit limit)',
            'sales.cancel' => 'Cancel completed sales without returns (restocks goods and reverses payments)',
            'returns.view' => 'View sales returns and their refunds in accessible branches',
            'returns.create' => 'Request returns against sale invoices',
            'returns.approve' => 'Approve or reject return requests and issue refunds (own returns complete at once)',
            'returns.manage' => 'Manage return reasons',
            'payments.collect' => 'Receive payments from customers against what they owe',
        ];
    }
}
