<?php

namespace App\Modules\Inventory;

use App\Modules\Imports\Application\Contracts\ImportHandler;
use App\Modules\Inventory\Application\Contracts\BatchDirectory;
use App\Modules\Inventory\Application\Contracts\ReplenishmentData;
use App\Modules\Inventory\Application\Contracts\SerialRegister;
use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Application\Contracts\StockLevels;
use App\Modules\Inventory\Application\Contracts\StockValuation;
use App\Modules\Inventory\Application\Events\StockFellBelowReorderLevel;
use App\Modules\Inventory\Application\Imports\OpeningStockImport;
use App\Modules\Inventory\Infrastructure\Console\SendExpiryAlertsCommand;
use App\Modules\Inventory\Infrastructure\Directory\EloquentBatchDirectory;
use App\Modules\Inventory\Infrastructure\Ledger\EloquentSerialRegister;
use App\Modules\Inventory\Infrastructure\Ledger\EloquentStockLedger;
use App\Modules\Inventory\Infrastructure\Ledger\EloquentStockLevels;
use App\Modules\Inventory\Infrastructure\Ledger\EloquentStockValuation;
use App\Modules\Inventory\Infrastructure\Models\StockAdjustment;
use App\Modules\Inventory\Infrastructure\Models\StockReorderRule;
use App\Modules\Inventory\Infrastructure\Models\Stocktake;
use App\Modules\Inventory\Infrastructure\Models\StockTransfer;
use App\Modules\Inventory\Infrastructure\Notifications\NotifyLowStock;
use App\Modules\Inventory\Infrastructure\Products\InventoryVariantStock;
use App\Modules\Inventory\Infrastructure\Replenishment\EloquentReplenishmentData;
use App\Modules\Products\Application\Contracts\VariantStock;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Route;

/**
 * Stock levels, the stock ledger, batches/expiry, adjustments, transfers and valuation;
 * per-store reorder rules and replenishment settings (SC1, `ReplenishmentData`); stocktake
 * sessions (ST1).
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
        // ST2d: the serial-number register (Purchasing and Sales call it too).
        $this->app->bind(SerialRegister::class, EloquentSerialRegister::class);
        // P1a: stock in the product variant grid (the contract is declared by Products).
        $this->app->bind(VariantStock::class, InventoryVariantStock::class);
        // ST1: opening stock import (Imports module).
        $this->app->tag([OpeningStockImport::class], ImportHandler::TAG);
    }

    public function boot(): void
    {
        Route::model('adjustment', StockAdjustment::class);
        Route::model('transfer', StockTransfer::class);
        Route::model('reorderRule', StockReorderRule::class);
        Route::model('stocktake', Stocktake::class);
        Event::listen(StockFellBelowReorderLevel::class, NotifyLowStock::class);

        parent::boot();

        if ($this->app->runningInConsole()) {
            // R1: the daily batch-expiry alert.
            $this->commands([SendExpiryAlertsCommand::class]);
        }
    }

    protected function permissions(): array
    {
        return [
            'inventory.view' => 'View stock levels, batches, movements, adjustments and transfers',
            'inventory.adjust' => 'Post stock adjustments, including opening stock',
            'inventory.transfer' => 'Dispatch, receive and cancel stock transfers',
            'inventory.manage' => 'Manage per-store reorder rules and replenishment settings',
            // ST1: counting only; posting a stocktake needs inventory.adjust.
            'inventory.stocktake' => 'Count stock in stocktakes',
        ];
    }
}
