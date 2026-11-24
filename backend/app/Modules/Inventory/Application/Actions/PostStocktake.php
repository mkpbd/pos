<?php

namespace App\Modules\Inventory\Application\Actions;

use App\Modules\Inventory\Application\Services\StocktakeAccess;
use App\Modules\Inventory\Domain\StocktakeStatus;
use App\Modules\Inventory\Domain\UncountedPolicy;
use App\Modules\Inventory\Infrastructure\Models\Stocktake;
use App\Modules\Inventory\Infrastructure\Models\StocktakeLine;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Support\Facades\DB;

/**
 * ST1: posts a stocktake as one stock adjustment (reason `count`). Each counted line with a
 * difference becomes an adjustment line of `counted − system snapshot` (the snapshot taken
 * when the line was last counted), so sales after a shelf was counted are not undone. With the
 * `zero` policy, uncounted lines count as zero with a snapshot taken now, under the row lock;
 * with `ignore` they are left alone. Nothing to change → posted without an adjustment. The
 * stocktake is read-only afterwards.
 */
class PostStocktake
{
    public function __construct(
        private readonly StocktakeAccess $access,
        private readonly PostStockAdjustment $adjustments,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @throws BusinessRuleViolation INVALID_STATUS_CHANGE (409), INSUFFICIENT_STOCK
     */
    public function __invoke(TenantUser $actor, Stocktake $stocktake, UncountedPolicy $policy): Stocktake
    {
        return DB::transaction(function () use ($actor, $stocktake, $policy) {
            // FOR UPDATE: waits for counts in flight (they hold the row FOR SHARE).
            $locked = $this->access->lockForChange($actor, $stocktake);
            if ($locked->status !== StocktakeStatus::Counting) {
                throw StocktakeAccess::invalidChange($locked, 'posted');
            }

            $lines = StocktakeLine::query()->where('stocktake_id', $locked->id)
                ->when($policy === UncountedPolicy::Ignore, fn ($q) => $q->whereNotNull('counted_quantity'))
                ->orderBy('position')->orderBy('id')
                ->get();

            $result = $this->adjustments->postCount($actor, $locked->store_id, $lines->map(fn (StocktakeLine $l) => [
                'variant_id' => $l->variant_id,
                'batch_id' => $l->batch_id,
                'counted_quantity' => $l->counted_quantity ?? '0',
                'system_quantity' => $l->counted_quantity === null ? null : $l->system_quantity,
            ])->values()->all(), "Stocktake {$locked->number}");

            $now = now();
            $zeroed = 0;
            foreach ($lines->values() as $i => $line) {
                if ($line->counted_quantity === null) {
                    $line->update(['counted_quantity' => '0', 'system_quantity' => $result['system'][$i], 'counted_at' => $now, 'counted_by' => $actor->getAuthIdentifier()]);
                    $zeroed++;
                }
            }

            $adjustment = $result['adjustment'];
            $locked->update([
                'status' => StocktakeStatus::Posted,
                'uncounted_policy' => $policy,
                'posted_at' => $now,
                'posted_by' => $actor->getAuthIdentifier(),
                'adjustment_id' => $adjustment?->id,
            ]);

            $this->audit->record('stocktake.posted', $locked, old: ['status' => StocktakeStatus::Counting->value], new: [
                'number' => $locked->number,
                'status' => StocktakeStatus::Posted->value,
                'uncounted_policy' => $policy->value,
                'adjustment' => $adjustment?->number,
                'adjusted_lines' => $adjustment === null ? 0 : $adjustment->lines()->count(),
                'zeroed_lines' => $zeroed,
            ]);

            return $locked;
        });
    }
}
