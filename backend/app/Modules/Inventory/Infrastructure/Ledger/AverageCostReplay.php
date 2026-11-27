<?php

namespace App\Modules\Inventory\Infrastructure\Ledger;

use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * ST2d backfill of `stock_movements.average_cost_after`: replays every store × variant × batch
 * level's movements in ledger order (created_at, then id — uuid7, so insertion order within one
 * posting) with the exact weighted-average rule of EloquentStockLedger / EloquentStockValuation:
 *  - inbound: from zero or negative stock the average becomes the unit cost, otherwise
 *    (qty × avg + in × cost) / new qty at 4 dp;
 *  - landed_cost (value only): (qty × avg + value) / qty at 4 dp;
 *  - outbound: unchanged.
 * Self-check: the replayed last average must equal stock_levels.average_cost.
 * Runs across all organizations (no tenant scope); the append-only trigger is lifted only
 * for the duration of the backfill.
 */
final class AverageCostReplay
{
    private const CHUNK = 500;

    /** @return int levels whose replayed average differs from stock_levels.average_cost */
    public function run(): int
    {
        $mismatches = 0;
        DB::statement('ALTER TABLE stock_movements DISABLE TRIGGER stock_movements_append_only');
        try {
            DB::table('stock_levels')->select(['id', 'store_id', 'variant_id', 'batch_id', 'average_cost'])
                ->chunkById(self::CHUNK, function ($levels) use (&$mismatches) {
                    foreach ($levels as $level) {
                        if (! $this->replay($level)) {
                            $mismatches++;
                        }
                    }
                });
        } finally {
            DB::statement('ALTER TABLE stock_movements ENABLE TRIGGER stock_movements_append_only');
        }

        if ($mismatches > 0) {
            Log::warning("Average cost backfill: {$mismatches} stock level(s) differ from their replayed ledger.");
        }

        return $mismatches;
    }

    private function replay(object $level): bool
    {
        $average = '0.0000';
        $pending = [];
        $movements = DB::table('stock_movements')
            ->where('store_id', $level->store_id)
            ->where('variant_id', $level->variant_id)
            ->when($level->batch_id, fn ($q, $b) => $q->where('batch_id', $b), fn ($q) => $q->whereNull('batch_id'))
            ->orderBy('created_at')->orderBy('id')
            ->select(['id', 'type', 'quantity', 'unit_cost', 'value', 'balance_after']);

        foreach ($movements->lazy(2000) as $m) {
            $type = MovementType::from($m->type);
            $before = Decimal::sub((string) $m->balance_after, (string) $m->quantity, 3);
            if ($type->isValueOnly()) {
                $average = Decimal::div(Decimal::add(Decimal::mul($before, $average, 8), (string) $m->value, 8), $before, 4);
            } elseif ($type->isInbound()) {
                $cost = Decimal::round((string) $m->unit_cost, 4);
                $average = Decimal::compare($before, '0') <= 0
                    ? $cost
                    : Decimal::div(Decimal::add(Decimal::mul($before, $average, 8), Decimal::mul((string) $m->quantity, $cost, 8), 8), (string) $m->balance_after, 4);
            }
            $pending[] = [$m->id, $average];
            if (count($pending) >= self::CHUNK) {
                $this->write($pending);
                $pending = [];
            }
        }
        $this->write($pending);

        return Decimal::compare($average, (string) $level->average_cost) === 0;
    }

    /**
     * @param  list<array{0: string, 1: string}>  $pairs
     */
    private function write(array $pairs): void
    {
        if ($pairs === []) {
            return;
        }
        $values = implode(', ', array_fill(0, count($pairs), '(?::uuid, ?::numeric)'));
        DB::update(
            "UPDATE stock_movements m SET average_cost_after = v.a FROM (VALUES {$values}) AS v(id, a) WHERE m.id = v.id",
            array_merge(...array_map(fn (array $p) => [$p[0], $p[1]], $pairs)),
        );
    }
}
