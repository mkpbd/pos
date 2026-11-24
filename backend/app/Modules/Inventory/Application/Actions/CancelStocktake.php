<?php

namespace App\Modules\Inventory\Application\Actions;

use App\Modules\Inventory\Application\Services\StocktakeAccess;
use App\Modules\Inventory\Domain\StocktakeStatus;
use App\Modules\Inventory\Infrastructure\Models\Stocktake;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use Illuminate\Support\Facades\DB;

/**
 * ST1: abandons a draft or counting stocktake; its counts are kept (read-only) and the stock is
 * not touched. Frees the store for a new stocktake.
 */
class CancelStocktake
{
    public function __construct(
        private readonly StocktakeAccess $access,
        private readonly AuditTrail $audit,
    ) {}

    public function __invoke(TenantUser $actor, Stocktake $stocktake): Stocktake
    {
        return DB::transaction(function () use ($actor, $stocktake) {
            $locked = $this->access->lockForChange($actor, $stocktake);
            if (! $locked->status->isOpen()) {
                throw StocktakeAccess::invalidChange($locked, 'cancelled');
            }
            $from = $locked->status->value;

            $locked->update(['status' => StocktakeStatus::Cancelled, 'cancelled_at' => now(), 'cancelled_by' => $actor->getAuthIdentifier()]);
            $this->audit->record('stocktake.cancelled', $locked, old: ['status' => $from], new: ['number' => $locked->number, 'status' => StocktakeStatus::Cancelled->value]);

            return $locked;
        });
    }
}
