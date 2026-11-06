<?php

namespace App\Modules\Inventory;

use App\Modules\Inventory\Application\Contracts\BatchDirectory;
use App\Modules\Inventory\Application\Contracts\ReplenishmentData;
use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Application\Contracts\StockLevels;
use App\Modules\Inventory\Application\Contracts\StockValuation;
use App\Modules\Inventory\Application\Events\StockFellBelowReorderLevel;
use App\Modules\Inventory\Infrastructure\Directory\EloquentBatchDirectory;
use App\Modules\Inventory\Infrastructure\Ledger\EloquentStockLedger;
use App\Modules\Inventory\Infrastructure\Ledger\EloquentStockLevels;
use App\Modules\Inventory\Infrastructure\Ledger\EloquentStockValuation;
use App\Modules\Inventory\Infrastructure\Models\StockAdjustment;
use App\Modules\Inventory\Infrastructure\Models\StockReorderRule;
use App\Modules\Inventory\Infrastructure\Models\StockTransfer;
use App\Modules\Inventory\Infrastructure\Notifications\NotifyLowStock;
use App\Modules\Inventory\Infrastructure\Replenishment\EloquentReplenishmentData;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Route;

/**
 * Stock levels, the stock ledger, batches/expiry, adjustments, transfers and valuation;
 * per-store reorder rules and replenishment settings (SC1, `ReplenishmentData`).
 */
class InventoryServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(StockLedger::class, EloquentStockLedger::class);
        $this->app->bind(BatchDirectory::class, EloquentBatchDirectory::class);
        $this->app->bind(StockLevels::class, EloquentStockLevels::class);
        $this->app->bind(StockValuation::class, EloquentStockValuation::class);
        $this->app->bind(ReplenishmentData::class, EloquentReplenishmentData::class);
    }

    public function boot(): void
    {
        Route::model('adjustment', StockAdjustment::class);
        Route::model('transfer', StockTransfer::class);
        Route::model('reorderRule', StockReorderRule::class);
        Event::listen(StockFellBelowReorderLevel::class, NotifyLowStock::class);

        parent::boot();
    }

    protected function permissions(): array
    {
        return [
            'inventory.view' => 'View stock levels, batches, movements, adjustments and transfers',
            'inventory.adjust' => 'Post stock adjustments, including opening stock',
            'inventory.transfer' => 'Dispatch, receive and cancel stock transfers',
            'inventory.manage' => 'Manage per-store reorder rules and replenishment settings',
        ];
    }
}
