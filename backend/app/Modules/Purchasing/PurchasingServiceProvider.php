<?php

namespace App\Modules\Purchasing;

use App\Modules\Purchasing\Infrastructure\Console\SendReorderNotificationsCommand;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceipt;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrder;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Support\Facades\Route;

/**
 * Purchase orders, goods receipts (supplier invoices), purchase returns, supplier payments
 * and supplier balances; the supplier catalog, reorder suggestions and the daily reorder
 * notification (`purchasing:reorder-notifications`, SC1).
 */
class PurchasingServiceProvider extends ModuleServiceProvider
{
    public function boot(): void
    {
        Route::model('order', PurchaseOrder::class);
        Route::model('receipt', GoodsReceipt::class);

        parent::boot();

        if ($this->app->runningInConsole()) {
            $this->commands([SendReorderNotificationsCommand::class]);
        }
    }

    protected function permissions(): array
    {
        return [
            'purchases.view' => 'View purchase orders, receipts, returns, supplier payments and balances',
            'purchases.manage' => 'Create, edit, place and cancel purchase orders',
            'purchases.receive' => 'Receive goods and record supplier invoices',
            'purchases.return' => 'Return goods to suppliers',
            'purchases.pay' => 'Record payments to suppliers',
        ];
    }
}
