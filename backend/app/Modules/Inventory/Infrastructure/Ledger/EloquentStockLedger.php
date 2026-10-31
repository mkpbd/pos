<?php

namespace App\Modules\Inventory\Infrastructure\Ledger;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Application\Events\StockFellBelowReorderLevel;
use App\Modules\Inventory\Domain\StockChange;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Inventory\Infrastructure\Models\StockLevel;
use App\Modules\Inventory\Infrastructure\Models\StockMovement;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use LogicException;

/**
 * Concurrency model:
 *  1. All affected stock_levels rows are locked with SELECT … FOR UPDATE, always in the
 *     same (store, variant, batch) order, so two transactions can never wait on each other
 *     in a cycle (no deadlocks).
 *  2. The quantity check happens after the lock, so two sales of the last unit cannot both
 *     succeed: the second waits for the first to commit and then sees the reduced quantity.
 *  3. Level update and ledger row are written in the caller's transaction.
 *
 * Valuation is weighted average cost per stock level: inbound movements blend their unit
 * cost into the average; outbound movements leave at the current average (or at an explicit
 * cost, e.g. a purchase return at the original receipt cost).
 */
class EloquentStockLedger implements StockLedger
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly BranchDirectory $branches,
        private readonly ProductDirectory $products,
    ) {}

    public function post(array $changes, StockReference $reference): array
    {
        if (DB::transactionLevel() === 0) {
            throw new LogicException('Stock can only be posted inside a database transaction.');
        }
        if ($changes === []) {
            return [];
        }

        $organizationId = $this->tenant->requireOrganization();
        $stores = $this->stores($organizationId, $changes);
        $variants = $this->products->variants($organizationId, array_map(fn (StockChange $c) => $c->variantId, $changes));

        $order = array_keys($changes);
        usort($order, fn (int $a, int $b) => strcmp($changes[$a]->lockKey(), $changes[$b]->lockKey()) ?: $a <=> $b);

        $results = array_fill(0, count($changes), null);
        $totalsBefore = [];
        $now = now();

        foreach ($order as $index) {
            $change = $changes[$index];
            $variant = $variants[$change->variantId] ?? throw new BusinessRuleViolation('UNKNOWN_PRODUCT', 'A product in this document does not exist.', ['variant_id' => $change->variantId]);
            if (! $variant['track_stock']) {
                continue;
            }

            $store = $stores[$change->storeId];
            $level = $this->lockLevel($organizationId, $store['branch_id'], $change);
            $pairKey = $change->storeId.'|'.$change->variantId;
            $totalsBefore[$pairKey] ??= [$store, $variant, $this->storeTotal($change->storeId, $change->variantId)];

            $signed = $change->signedQuantity();
            $newQuantity = Decimal::add($level->quantity, $signed, 3);

            if ($change->type->isInbound()) {
                $cost = Decimal::round((string) $change->unitCost, 4);
                $newAverage = Decimal::compare($level->quantity, '0') <= 0
                    ? $cost
                    : Decimal::div(
                        Decimal::add(Decimal::mul($level->quantity, $level->average_cost, 8), Decimal::mul($signed, $cost, 8), 8),
                        $newQuantity,
                        4,
                    );
            } else {
                if (Decimal::isNegative($newQuantity) && ! $store['allow_negative_stock']) {
                    throw new BusinessRuleViolation('INSUFFICIENT_STOCK', "Not enough stock of {$variant['product_name']} ({$variant['sku']}) in {$store['name']}.", [
                        'variant_id' => $change->variantId,
                        'sku' => $variant['sku'],
                        'store_id' => $change->storeId,
                        'batch_id' => $change->batchId,
                        'available' => Decimal::round($level->quantity, 3),
                        'requested' => Decimal::round($change->quantity, 3),
                    ]);
                }
                $cost = $change->unitCost !== null ? Decimal::round($change->unitCost, 4) : $level->average_cost;
                $newAverage = $level->average_cost;
            }

            StockLevel::query()->whereKey($level->id)->update([
                'quantity' => $newQuantity,
                'average_cost' => $newAverage,
                'updated_at' => $now,
            ]);

            $movement = StockMovement::query()->create([
                'organization_id' => $organizationId,
                'branch_id' => $store['branch_id'],
                'store_id' => $change->storeId,
                'variant_id' => $change->variantId,
                'batch_id' => $change->batchId,
                'type' => $change->type,
                'quantity' => $signed,
                'unit_cost' => $cost,
                'balance_after' => $newQuantity,
                'reference_type' => $reference->type,
                'reference_id' => $reference->id,
                'reference_number' => $reference->number,
                'created_by' => Auth::id(),
                'created_at' => $now,
            ]);

            $results[$index] = ['movement_id' => $movement->id, 'unit_cost' => $cost, 'balance_after' => $newQuantity];
        }

        $this->detectReorderCrossings($organizationId, $totalsBefore);

        return $results;
    }

    /**
     * @param  list<StockChange>  $changes
     * @return array<string, array{id: string, name: string, branch_id: string, allow_negative_stock: bool}>
     */
    private function stores(string $organizationId, array $changes): array
    {
        $stores = [];
        foreach (array_unique(array_map(fn (StockChange $c) => $c->storeId, $changes)) as $storeId) {
            $store = $this->branches->store($storeId, $organizationId);
            if ($store === null || ! $store['is_active'] || ! $store['branch_is_active']) {
                throw new BusinessRuleViolation('STORE_INACTIVE', 'The selected store does not exist or is inactive.', ['store_id' => $storeId]);
            }
            $stores[$storeId] = $store;
        }

        return $stores;
    }

    /**
     * Creates the level row on first use, then locks it.
     */
    private function lockLevel(string $organizationId, string $branchId, StockChange $change): StockLevel
    {
        StockLevel::query()->insertOrIgnore([
            'id' => (string) Str::uuid7(),
            'organization_id' => $organizationId,
            'branch_id' => $branchId,
            'store_id' => $change->storeId,
            'variant_id' => $change->variantId,
            'batch_id' => $change->batchId,
            'quantity' => '0',
            'average_cost' => '0',
            'updated_at' => now(),
        ]);

        return StockLevel::query()
            ->where('store_id', $change->storeId)
            ->where('variant_id', $change->variantId)
            ->when($change->batchId, fn ($q, $batchId) => $q->where('batch_id', $batchId), fn ($q) => $q->whereNull('batch_id'))
            ->lockForUpdate()
            ->firstOrFail();
    }

    private function storeTotal(string $storeId, string $variantId): string
    {
        return array_reduce(
            StockLevel::query()->where('store_id', $storeId)->where('variant_id', $variantId)->pluck('quantity')->all(),
            fn (string $sum, string $q) => Decimal::add($sum, $q, 3),
            '0.000',
        );
    }

    /**
     * @param  array<string, array{0: array<string, mixed>, 1: array<string, mixed>, 2: string}>  $totalsBefore
     */
    private function detectReorderCrossings(string $organizationId, array $totalsBefore): void
    {
        foreach ($totalsBefore as [$store, $variant, $before]) {
            $reorder = (string) $variant['reorder_level'];
            if (Decimal::compare($reorder, '0') <= 0) {
                continue; // reorder level 0 = alerts off
            }

            $after = $this->storeTotal($store['id'], $variant['variant_id']);
            if (Decimal::compare($before, $reorder) > 0 && Decimal::compare($after, $reorder) <= 0) {
                event(new StockFellBelowReorderLevel($organizationId, $store['branch_id'], $store['id'], $variant['variant_id'], $after, Decimal::round($reorder, 3)));
            }
        }
    }
}
