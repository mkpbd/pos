<?php

namespace App\Modules\Sales;

use App\Modules\Customers\Application\Contracts\CustomerDues;
use App\Modules\Sales\Application\Contracts\LoyaltyProgram;
use App\Modules\Sales\Application\Contracts\SaleBaskets;
use App\Modules\Sales\Application\Services\CustomerCredit;
use App\Modules\Sales\Application\Services\IssuedCreditNotes;
use App\Modules\Sales\Application\Services\NoLoyaltyProgram;
use App\Modules\Sales\Infrastructure\EloquentSaleBaskets;
use App\Modules\Sales\Infrastructure\Models\ReturnReason;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SaleReturn;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
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
        // P1b: POS sales as baskets for "frequently bought together" (OnlineCatalog).
        $this->app->bind(SaleBaskets::class, EloquentSaleBaskets::class);
        // POS1b: credit notes issued in this request (their code is shown once). StoreCredit and
        // GiftCards are bound by the StoredValue module.
        $this->app->scoped(IssuedCreditNotes::class);
        // R1: customers' dues for due reminders (the contract is declared by Customers).
        $this->app->bind(CustomerDues::class, CustomerCredit::class);
    }

    public function boot(): void
    {
        Route::model('sale', Sale::class);
        Route::model('saleReturn', SaleReturn::class);
        Route::model('returnReason', ReturnReason::class);

        parent::boot();

        // POS1d: digital receipts — sending costs SMS credit; the public page is per IP.
        RateLimiter::for('receipt-send', fn (Request $request) => Limit::perMinute(10)->by('receipt-send:'.($request->user()?->getAuthIdentifier() ?: $request->ip())));
        RateLimiter::for('receipt-view', fn (Request $request) => Limit::perMinute(30)->by('receipt-view:'.$request->ip()));
    }

    protected function permissions(): array
    {
        return [
            'sales.view' => 'View sales history, invoices and the daily sales summary of accessible branches',
            'sales.discount' => 'Give manual item and invoice discounts at the till (within product limits)',
            // POS1a: without it a manager approves each changed price at the till.
            'sales.price_override' => "Change an item's price at the till",
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
