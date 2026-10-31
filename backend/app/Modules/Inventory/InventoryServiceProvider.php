<?php

namespace App\Modules\Inventory;

use App\Modules\Inventory\Application\Contracts\BatchDirectory;
use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Application\Events\StockFellBelowReorderLevel;
use App\Modules\Inventory\Infrastructure\Directory\EloquentBatchDirectory;
use App\Modules\Inventory\Infrastructure\Ledger\EloquentStockLedger;
use App\Modules\Inventory\Infrastructure\Models\StockAdjustment;
use App\Modules\Inventory\Infrastructure\Models\StockTransfer;
use App\Modules\Inventory\Infrastructure\Notifications\NotifyLowStock;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Route;

/**
 * Stock levels, the stock ledger, batches/expiry, adjustments, transfers and valuation.
 */
class InventoryServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(StockLedger::class, EloquentStockLedger::class);
        $this->app->bind(BatchDirectory::class, EloquentBatchDirectory::class);
    }

    public function boot(): void
    {
        Route::model('adjustment', StockAdjustment::class);
        Route::model('transfer', StockTransfer::class);
        Event::listen(StockFellBelowReorderLevel::class, NotifyLowStock::class);

        parent::boot();
    }

    protected function permissions(): array
    {
        return [
            'inventory.view' => 'View stock levels, batches, movements, adjustments and transfers',
            'inventory.adjust' => 'Post stock adjustments, including opening stock',
            'inventory.transfer' => 'Dispatch, receive and cancel stock transfers',
        ];
    }
}
