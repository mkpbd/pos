<?php

namespace App\Modules\Inventory\Infrastructure\Ledger;

use App\Modules\Inventory\Application\Contracts\StockValuation;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Inventory\Domain\StockRevaluation;
use App\Modules\Inventory\Infrastructure\Models\StockLevel;
use App\Modules\Inventory\Infrastructure\Models\StockMovement;
use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * SC3 value-only adjustments on the weighted-average stock levels (see StockValuation).
 * Same lock order as EloquentStockLedger (store|variant|batch), so a revaluation and a
 * stock posting touching the same rows cannot deadlock.
 */
class EloquentStockValuation implements StockValuation
{
    public function __construct(private readonly TenantContext $tenant) {}

    public function onHandFromDocument(array $items, bool $lock = false): array
    {
        if ($lock && DB::transactionLevel() === 0) {
            throw new LogicException('Stock levels can only be locked inside a database transaction.');
        }

        $levels = [];
        foreach ($items as $item) {
            $levels[self::key($item['store_id'], $item['variant_id'], $item['batch_id'])] = $item;
        }
        ksort($levels, SORT_STRING);
        $quantities = [];
        $averages = [];
        foreach ($levels as $key => $item) {
            $level = $this->level($item['store_id'], $item['variant_id'], $item['batch_id'])
                ->when($lock, fn (Builder $q) => $q->lockForUpdate())
                ->first();
            $quantities[$key] = $level === null ? '0.000' : Decimal::round($level->quantity, 3);
            $averages[$key] = $level === null ? '0.0000' : Decimal::round($level->average_cost, 4);
        }

        $memo = [];
        $results = [];
        foreach ($items as $item) {
            $levelKey = self::key($item['store_id'], $item['variant_id'], $item['batch_id']);
            $memoKey = $item['reference_type'].'|'.$item['reference_id'].'|'.$levelKey;
            $results[] = $memo[$memoKey] ??= $this->attribute($item, $quantities[$levelKey]) + ['average_cost' => $averages[$levelKey]];
        }

        return $results;
    }

    public function revalue(array $revaluations, StockReference $reference): array
    {
        if (DB::transactionLevel() === 0) {
            throw new LogicException('Stock can only be revalued inside a database transaction.');
        }

        $organizationId = $this->tenant->requireOrganization();
        $order = array_keys($revaluations);
        usort($order, fn (int $a, int $b) => strcmp($revaluations[$a]->lockKey(), $revaluations[$b]->lockKey()) ?: $a <=> $b);
        $results = array_fill(0, count($revaluations), null);
        $now = now();

        foreach ($order as $index) {
            /** @var StockRevaluation $change */
            $change = $revaluations[$index];
            $level = $this->level($change->storeId, $change->variantId, $change->batchId)->lockForUpdate()->first();
            if ($level === null || Decimal::compare($level->quantity, '0') <= 0) {
                throw new LogicException('Value can only be added to stock on hand.');
            }

            $value = Decimal::round($change->value, 2);
            $before = Decimal::round($level->average_cost, 4);
            $after = Decimal::div(Decimal::add(Decimal::mul($level->quantity, $before, 8), $value, 8), $level->quantity, 4);

            StockLevel::query()->whereKey($level->id)->update(['average_cost' => $after, 'updated_at' => $now]);
            $movement = StockMovement::query()->create([
                'organization_id' => $organizationId,
                'branch_id' => $level->branch_id,
                'store_id' => $change->storeId,
                'variant_id' => $change->variantId,
                'batch_id' => $change->batchId,
                'type' => $change->type,
                'quantity' => '0',
                'unit_cost' => Decimal::sub($after, $before, 4),
                'value' => $value,
                'balance_after' => $level->quantity,
                'reference_type' => $reference->type,
                'reference_id' => $reference->id,
                'reference_number' => $reference->number,
                'created_by' => StaffActor::id(),
                'created_at' => $now,
            ]);

            $results[$index] = [
                'movement_id' => $movement->id,
                'quantity' => Decimal::round($level->quantity, 3),
                'average_before' => $before,
                'average_after' => $after,
            ];
        }

        return $results;
    }

    /**
     * @param  array{reference_type: string, reference_id: string, store_id: string, variant_id: string, batch_id: ?string}  $item
     * @return array{on_hand: string, received: string, level_quantity: string, later_inbound: string}
     */
    private function attribute(array $item, string $levelQuantity): array
    {
        $own = $this->movements($item)
            ->where('reference_type', $item['reference_type'])
            ->where('reference_id', $item['reference_id'])
            ->where('quantity', '>', 0)
            ->orderBy('created_at')->orderBy('id')
            ->get(['id', 'quantity', 'created_at']);
        if ($own->isEmpty()) {
            return ['on_hand' => '0.000', 'received' => '0.000', 'level_quantity' => $levelQuantity, 'later_inbound' => '0.000'];
        }

        $received = $own->reduce(fn (string $sum, StockMovement $m) => Decimal::add($sum, $m->quantity, 3), '0.000');
        /** @var StockMovement $last */
        $last = $own->last();
        $at = $last->getRawOriginal('created_at'); // the stored value, compared as stored
        $later = $this->movements($item)
            ->where('quantity', '>', 0)
            ->where(fn (Builder $q) => $q->where('reference_type', '!=', $item['reference_type'])->orWhere('reference_id', '!=', $item['reference_id']))
            ->where(fn (Builder $q) => $q->where('created_at', '>', $at)
                ->orWhere(fn (Builder $same) => $same->where('created_at', $at)->where('id', '>', $last->id)))
            ->pluck('quantity')
            ->reduce(fn (string $sum, $q) => Decimal::add($sum, (string) $q, 3), '0.000');

        $onHand = Decimal::sub($levelQuantity, $later, 3);
        $onHand = Decimal::isNegative($onHand) ? '0.000' : Decimal::min($onHand, $received);

        return ['on_hand' => Decimal::round($onHand, 3), 'received' => $received, 'level_quantity' => $levelQuantity, 'later_inbound' => $later];
    }

    /**
     * @param  array{store_id: string, variant_id: string, batch_id: ?string}  $item
     * @return Builder<StockMovement>
     */
    private function movements(array $item): Builder
    {
        return StockMovement::query()
            ->where('store_id', $item['store_id'])
            ->where('variant_id', $item['variant_id'])
            ->when($item['batch_id'], fn (Builder $q, string $b) => $q->where('batch_id', $b), fn (Builder $q) => $q->whereNull('batch_id'));
    }

    /**
     * @return Builder<StockLevel>
     */
    private function level(string $storeId, string $variantId, ?string $batchId): Builder
    {
        return StockLevel::query()
            ->where('store_id', $storeId)
            ->where('variant_id', $variantId)
            ->when($batchId, fn (Builder $q, string $b) => $q->where('batch_id', $b), fn (Builder $q) => $q->whereNull('batch_id'));
    }

    private static function key(string $storeId, string $variantId, ?string $batchId): string
    {
        return $storeId.'|'.$variantId.'|'.($batchId ?? '');
    }
}
