<?php

namespace App\Modules\Inventory\Application\Services;

use App\Modules\Inventory\Domain\StocktakeStatus;
use App\Modules\Inventory\Infrastructure\Models\Stocktake;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * ST1: loads a stocktake for a write under a row lock.
 *
 * Lock protocol: counting (several people at once) takes the stocktake row FOR SHARE, status
 * changes (start, post, cancel) take it FOR UPDATE — so a post waits for the counts in flight
 * and every count after it sees the stocktake posted. Both then lock stock levels (counts
 * FOR SHARE to snapshot, the post FOR UPDATE through the ledger) in the ledger's order.
 */
class StocktakeAccess
{
    /**
     * A stocktake of a branch the user cannot access does not exist for them.
     */
    public function assertVisible(TenantUser $actor, Stocktake $stocktake): void
    {
        if (! $actor->canAccessBranch($stocktake->branch_id)) {
            throw new NotFoundHttpException;
        }
    }

    /**
     * Re-reads the stocktake FOR UPDATE (status changes). Call inside a transaction.
     */
    public function lockForChange(TenantUser $actor, Stocktake $stocktake): Stocktake
    {
        $this->assertVisible($actor, $stocktake);

        /** @var Stocktake */
        return Stocktake::query()->whereKey($stocktake->id)->lockForUpdate()->firstOrFail();
    }

    /**
     * Re-reads the stocktake FOR SHARE and checks it is being counted. Call inside a transaction.
     *
     * @throws BusinessRuleViolation STOCKTAKE_NOT_COUNTING (409)
     */
    public function lockForCounting(TenantUser $actor, Stocktake $stocktake): Stocktake
    {
        $this->assertVisible($actor, $stocktake);

        /** @var Stocktake $locked */
        $locked = Stocktake::query()->whereKey($stocktake->id)->sharedLock()->firstOrFail();
        if ($locked->status !== StocktakeStatus::Counting) {
            throw new BusinessRuleViolation('STOCKTAKE_NOT_COUNTING', $locked->status === StocktakeStatus::Draft
                ? "Start {$locked->number} before counting."
                : "{$locked->number} is {$locked->status->value}; counts can no longer change.", ['status' => $locked->status->value], 409);
        }

        return $locked;
    }

    public static function invalidChange(Stocktake $stocktake, string $to): BusinessRuleViolation
    {
        return new BusinessRuleViolation('INVALID_STATUS_CHANGE', "{$stocktake->number} is {$stocktake->status->value}; it cannot be {$to}.", [
            'from' => $stocktake->status->value,
            'to' => $to,
        ], 409);
    }
}
