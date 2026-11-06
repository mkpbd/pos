<?php

namespace App\Modules\Purchasing;

use App\Modules\Purchasing\Infrastructure\Console\SendReorderNotificationsCommand;
use App\Modules\Purchasing\Infrastructure\Console\SendRfqRemindersCommand;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceipt;
use App\Modules\Purchasing\Infrastructure\Models\LandedCostVoucher;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrder;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseRequisition;
use App\Modules\Purchasing\Infrastructure\Models\Rfq;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Support\Facades\Route;

/**
 * Purchase orders, goods receipts (supplier invoices), purchase returns, supplier payments
 * and supplier balances; the supplier catalog, reorder suggestions and the daily reorder
 * notification (`purchasing:reorder-notifications`, SC1); purchase requisitions with
 * amount-based approval, purchase order approval, RFQs with supplier quotes and awards, and
 * the daily quotes-overdue reminder (`purchasing:rfq-reminders`, SC2); landed costs on receipts
 * and landed cost vouchers, and the supplier performance read model (SC3).
 */
class PurchasingServiceProvider extends ModuleServiceProvider
{
    public function boot(): void
    {
        Route::model('order', PurchaseOrder::class);
        Route::model('receipt', GoodsReceipt::class);
        Route::model('requisition', PurchaseRequisition::class);
        Route::model('rfq', Rfq::class);
        Route::model('landedCostVoucher', LandedCostVoucher::class);

        parent::boot();

        if ($this->app->runningInConsole()) {
            $this->commands([SendReorderNotificationsCommand::class, SendRfqRemindersCommand::class]);
        }
    }

    protected function permissions(): array
    {
        return [
            'purchases.view' => 'View purchase orders, receipts, returns, supplier payments and balances',
            'purchases.manage' => 'Create, edit, place and cancel purchase orders; convert requisitions; run RFQs',
            'purchases.receive' => 'Receive goods and record supplier invoices',
            'purchases.return' => 'Return goods to suppliers',
            'purchases.pay' => 'Record payments to suppliers',
            // SC2: requisitions and approval limits.
            'purchases.request' => 'Raise, edit and submit own purchase requisitions',
            'purchases.approve' => 'Approve requisitions and purchase orders up to the manager limit',
            'purchases.approve_high' => 'Approve requisitions and purchase orders above the manager limit',
            'purchases.settings' => 'Change purchase approval limits',
            // SC3: landed costs billed after the goods (freight, duty…).
            'purchases.landed_cost' => 'Create, edit, delete and post landed cost vouchers',
        ];
    }
}
