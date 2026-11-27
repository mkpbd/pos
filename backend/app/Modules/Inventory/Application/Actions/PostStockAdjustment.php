<?php

namespace App\Modules\Inventory\Application\Actions;

use App\Modules\Inventory\Application\Contracts\SerialRegister;
use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Application\Services\StockLineRules;
use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Inventory\Domain\AdjustmentReason;
use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Domain\SerialStatus;
use App\Modules\Inventory\Domain\StockChange;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Inventory\Infrastructure\Models\StockAdjustment;
use App\Modules\Inventory\Infrastructure\Models\StockLevel;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Posts a stock adjustment: opening stock, physical-count differences, damage, expiry, theft
 * or corrections. Lines carry a signed quantity; increases are valued at the given unit cost
 * (or the product's purchase price), decreases at the current average cost.
 *
 * Q1: a stock count (reason `count`) may give a line's `counted_quantity` instead. Every stock
 * level of the document is locked (FOR UPDATE, in the ledger's lock order) before anything is
 * read, the difference `counted − on hand` becomes the line's signed quantity, and both numbers
 * are kept on the line. Batch-tracked products are counted per batch. Lines that match the
 * stock are skipped; when nothing differs the adjustment is refused (NOTHING_TO_ADJUST).
 */
class PostStockAdjustment
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly StoreAccess $storeAccess,
        private readonly StockLineRules $lineRules,
        private readonly ResolveBatch $resolveBatch,
        private readonly StockLedger $ledger,
        private readonly SequenceGenerator $sequences,
        private readonly AuditTrail $audit,
        private readonly ProductDirectory $products,
        private readonly SerialRegister $serialRegister,
    ) {}

    /**
     * @param  array{store_id: string, reason: string, note?: ?string, lines: list<array{variant_id: string, quantity?: ?string, counted_quantity?: ?string, unit_cost?: ?string, batch_id?: ?string, batch_number?: ?string, expires_on?: ?string, serials?: ?list<string>}>}  $data
     *
     * @throws BusinessRuleViolation NOTHING_TO_ADJUST, INSUFFICIENT_STOCK, STORE_INACTIVE, BATCH_EXPIRY_MISMATCH, SERIAL_IN_STOCK, SERIAL_NOT_IN_STOCK
     */
    public function __invoke(TenantUser $actor, array $data): StockAdjustment
    {
        $organizationId = $this->tenant->requireOrganization();
        $store = $this->storeAccess->require($actor, $data['store_id']);
        $reason = AdjustmentReason::from($data['reason']);
        $lines = array_values($data['lines']);

        // Counted lines keep their index (error paths point at the submitted line).
        $counted = array_filter($lines, fn (array $l) => ($l['counted_quantity'] ?? null) !== null);
        $signed = array_diff_key($lines, $counted);
        if ($counted !== [] && $reason !== AdjustmentReason::Count) {
            throw ValidationException::withMessages(['reason' => ['A counted quantity is only for the "Stock count" reason.']]);
        }

        $errors = [];
        foreach ($signed as $i => $line) {
            $quantity = (string) ($line['quantity'] ?? '0');
            $negative = Decimal::isNegative($quantity);
            if (Decimal::isZero($quantity)) {
                $errors["lines.{$i}.quantity"] = ['Enter a quantity other than zero.'];
            } elseif ($reason->isLossOnly() && ! $negative) {
                $errors["lines.{$i}.quantity"] = ['This reason can only reduce stock.'];
            } elseif ($reason === AdjustmentReason::Opening && $negative) {
                $errors["lines.{$i}.quantity"] = ['Opening stock must be positive.'];
            }
        }
        if ($counted !== []) {
            $info = $this->products->variants($organizationId, array_values(array_column($counted, 'variant_id')));
            foreach ($counted as $i => $line) {
                $variant = $info[$line['variant_id']] ?? null;
                if ($variant !== null && $variant['track_batches'] && ($line['batch_id'] ?? null) === null && blank($line['batch_number'] ?? null)) {
                    $errors["lines.{$i}.batch_id"] = ["{$variant['product_name']} is counted per batch: choose the batch you counted (one line per batch)."];
                }
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        $increases = array_filter($signed, fn (array $l) => ! Decimal::isNegative((string) $l['quantity']));
        $decreases = array_map(fn (array $l) => [...$l, 'quantity' => Decimal::negate((string) $l['quantity'], 3)], array_filter($signed, fn (array $l) => Decimal::isNegative((string) $l['quantity'])));
        // A counted line may add or remove stock: checked like an inbound line (batch number or existing batch).
        $countChecks = array_map(fn (array $l) => [...$l, 'quantity' => $l['counted_quantity']], $counted);
        $variants = $this->lineRules->validate($organizationId, $increases, 'in')
            + $this->lineRules->validate($organizationId, $decreases, 'out')
            + $this->lineRules->validate($organizationId, $countChecks, 'in');
        // ST2d: serial-numbered lines name their serials — except a stock count, which (like a
        // stocktake) moves quantities only: counting by serial is not supported.
        $serials = $reason === AdjustmentReason::Count ? [] : $this->lineRules->serials($signed, $variants);

        return DB::transaction(function () use ($actor, $organizationId, $store, $reason, $data, $lines, $counted, $variants, $serials) {
            $batchIds = [];
            foreach ($lines as $i => $line) {
                $batchIds[$i] = $line['batch_id'] ?? (filled($line['batch_number'] ?? null)
                    ? ($this->resolveBatch)($line['variant_id'], $line['batch_number'], $line['expires_on'] ?? null)->id
                    : null);
            }
            if ($reason === AdjustmentReason::Count) {
                $this->assertUniqueProductBatches($lines, $batchIds);
            }

            // Lock every level of the document before reading any (same order as the ledger: no deadlocks).
            $onHand = $this->lockLevels($organizationId, $store, $lines, $batchIds, $counted);

            /** @var array<int, array{line: array<string, mixed>, batch_id: ?string, quantity: string, counted: ?string, system: ?string}> $entries */
            $entries = [];
            foreach ($lines as $i => $line) {
                if (isset($counted[$i])) {
                    $system = $onHand[$this->lockKey($store['id'], $line['variant_id'], $batchIds[$i])] ?? '0.000';
                    $countedQuantity = Decimal::round((string) $line['counted_quantity'], 3);
                    $difference = Decimal::sub($countedQuantity, $system, 3);
                    if (Decimal::isZero($difference)) {
                        continue; // matches the stock: no movement
                    }
                    $entries[$i] = ['line' => $line, 'batch_id' => $batchIds[$i], 'quantity' => $difference, 'counted' => $countedQuantity, 'system' => Decimal::round($system, 3)];
                } else {
                    $entries[$i] = ['line' => $line, 'batch_id' => $batchIds[$i], 'quantity' => Decimal::round((string) $line['quantity'], 3), 'counted' => null, 'system' => null];
                }
            }
            if ($entries === []) {
                throw new BusinessRuleViolation('NOTHING_TO_ADJUST', 'Every counted quantity matches the stock, so there is nothing to adjust.');
            }
            $entries = array_values(array_map(fn (array $e, int $i) => $e + ['serials' => $serials[$i] ?? []], $entries, array_keys($entries)));

            $adjustment = StockAdjustment::query()->create([
                'organization_id' => $organizationId,
                'branch_id' => $store['branch_id'],
                'store_id' => $store['id'],
                'number' => $this->sequences->next($organizationId, 'stock_adjustment', 'ADJ-'),
                'reason' => $reason->value,
                'note' => $data['note'] ?? null,
                'created_by' => $actor->getAuthIdentifier(),
            ]);

            $changes = [];
            foreach ($entries as $entry) {
                $increase = ! Decimal::isNegative($entry['quantity']);
                $changes[] = new StockChange(
                    storeId: $store['id'],
                    variantId: $entry['line']['variant_id'],
                    batchId: $entry['batch_id'],
                    type: $reason === AdjustmentReason::Opening ? MovementType::Opening : ($increase ? MovementType::AdjustmentIn : MovementType::AdjustmentOut),
                    quantity: $increase ? $entry['quantity'] : Decimal::negate($entry['quantity'], 3),
                    unitCost: $increase ? ($entry['line']['unit_cost'] ?? $variants[$entry['line']['variant_id']]['purchase_price']) : null,
                );
            }

            $reference = new StockReference('stock_adjustment', $adjustment->id, $adjustment->number);
            // ST2d: serials come in (adjusted_in) or are written off before the stock moves (legacy rule).
            foreach ($entries as $entry) {
                if ($entry['serials'] === []) {
                    continue;
                }
                Decimal::isNegative($entry['quantity'])
                    ? $this->serialRegister->issue($store['id'], $entry['line']['variant_id'], $entry['serials'], SerialStatus::WrittenOff, $reference)
                    : $this->serialRegister->receive($store['id'], $entry['line']['variant_id'], $entry['serials'], $reference, 'adjusted_in');
            }

            $posted = $this->ledger->post($changes, $reference);

            foreach ($entries as $i => $entry) {
                $adjustment->lines()->create([
                    'organization_id' => $organizationId,
                    'variant_id' => $entry['line']['variant_id'],
                    'batch_id' => $entry['batch_id'],
                    'quantity' => $entry['quantity'],
                    'unit_cost' => $posted[$i]['unit_cost'] ?? '0',
                    'counted_quantity' => $entry['counted'],
                    'system_quantity' => $entry['system'],
                ]);
            }

            $this->audit->record('stock_adjustment.posted', $adjustment, new: [
                'number' => $adjustment->number,
                'reason' => $reason->value,
                'store_id' => $store['id'],
                'lines' => count($entries),
            ] + ($counted === [] ? [] : [
                'counted_lines' => count($counted),
                'unchanged_lines' => count($lines) - count($entries),
            ]));

            return $adjustment;
        });
    }

    /**
     * ST1: posts a stock count whose system quantities were snapshotted earlier — a stocktake
     * line keeps what the system held when it was last counted. Each line's signed quantity is
     * `counted − system snapshot` (not `counted − on hand now`), so sales and receipts made after
     * a shelf was counted stay in the stock; both numbers are kept on the line (the Q1 CHECK
     * `quantity = counted − system` holds). A line without `system_quantity` is snapshotted now,
     * under the row lock (the stocktake's "uncounted = zero" policy). Lines without a difference
     * and products that no longer track stock are skipped; when nothing differs nothing is posted
     * (`adjustment` null). Increases are valued at the stock row's current average cost (else the
     * product's purchase price), so found stock does not move the average. Runs inside the
     * caller's transaction (savepoint).
     *
     * @param  list<array{variant_id: string, batch_id: ?string, counted_quantity: string, system_quantity: ?string}>  $lines
     * @return array{adjustment: ?StockAdjustment, system: list<string>} the system quantity used per input line
     *
     * @throws BusinessRuleViolation INSUFFICIENT_STOCK (a decrease larger than what is on hand now)
     */
    public function postCount(TenantUser $actor, string $storeId, array $lines, ?string $note = null): array
    {
        $organizationId = $this->tenant->requireOrganization();
        $store = $this->storeAccess->require($actor, $storeId);
        $lines = array_values($lines);
        $variants = $this->products->variants($organizationId, array_values(array_unique(array_column($lines, 'variant_id'))));
        $batchIds = array_map(fn (array $l) => $l['batch_id'] ?? null, $lines);

        return DB::transaction(function () use ($actor, $organizationId, $store, $lines, $variants, $batchIds, $note) {
            // Lock every level of the document before reading any (same order as the ledger: no deadlocks).
            $onHand = $this->lockLevels($organizationId, $store, $lines, $batchIds, $lines);
            $costs = StockLevel::query()->where('store_id', $store['id'])
                ->whereIn('variant_id', array_values(array_unique(array_column($lines, 'variant_id'))))
                ->get(['variant_id', 'batch_id', 'average_cost'])
                ->mapWithKeys(fn (StockLevel $l) => [$this->lockKey($store['id'], $l->variant_id, $l->batch_id) => (string) $l->average_cost])
                ->all();

            $system = [];
            $entries = [];
            foreach ($lines as $i => $line) {
                $key = $this->lockKey($store['id'], $line['variant_id'], $batchIds[$i]);
                $system[$i] = Decimal::round((string) ($line['system_quantity'] ?? $onHand[$key] ?? '0'), 3);
                $counted = Decimal::round((string) $line['counted_quantity'], 3);
                $difference = Decimal::sub($counted, $system[$i], 3);
                $variant = $variants[$line['variant_id']] ?? null;
                if (Decimal::isZero($difference) || $variant === null || ! $variant['track_stock']) {
                    continue;
                }
                $average = $costs[$key] ?? '0';
                $entries[] = [
                    'variant_id' => $line['variant_id'], 'batch_id' => $batchIds[$i], 'quantity' => $difference,
                    'counted' => $counted, 'system' => $system[$i],
                    'unit_cost' => Decimal::compare($average, '0') > 0 ? $average : (string) $variant['purchase_price'],
                ];
            }
            if ($entries === []) {
                return ['adjustment' => null, 'system' => $system];
            }

            $adjustment = StockAdjustment::query()->create([
                'organization_id' => $organizationId,
                'branch_id' => $store['branch_id'],
                'store_id' => $store['id'],
                'number' => $this->sequences->next($organizationId, 'stock_adjustment', 'ADJ-'),
                'reason' => AdjustmentReason::Count->value,
                'note' => $note,
                'created_by' => $actor->getAuthIdentifier(),
            ]);

            $changes = [];
            foreach ($entries as $entry) {
                $increase = ! Decimal::isNegative($entry['quantity']);
                $changes[] = new StockChange(
                    storeId: $store['id'],
                    variantId: $entry['variant_id'],
                    batchId: $entry['batch_id'],
                    type: $increase ? MovementType::AdjustmentIn : MovementType::AdjustmentOut,
                    quantity: $increase ? $entry['quantity'] : Decimal::negate($entry['quantity'], 3),
                    unitCost: $increase ? $entry['unit_cost'] : null,
                );
            }
            $posted = $this->ledger->post($changes, new StockReference('stock_adjustment', $adjustment->id, $adjustment->number));

            foreach ($entries as $i => $entry) {
                $adjustment->lines()->create([
                    'organization_id' => $organizationId,
                    'variant_id' => $entry['variant_id'],
                    'batch_id' => $entry['batch_id'],
                    'quantity' => $entry['quantity'],
                    'unit_cost' => $posted[$i]['unit_cost'] ?? '0',
                    'counted_quantity' => $entry['counted'],
                    'system_quantity' => $entry['system'],
                ]);
            }

            $this->audit->record('stock_adjustment.posted', $adjustment, new: [
                'number' => $adjustment->number,
                'reason' => AdjustmentReason::Count->value,
                'store_id' => $store['id'],
                'lines' => count($entries),
                'counted_lines' => count($lines),
                'unchanged_lines' => count($lines) - count($entries),
                'snapshots' => true,
            ]);

            return ['adjustment' => $adjustment, 'system' => $system];
        });
    }

    /**
     * A stock count may list one product on several lines, but each product × batch only once.
     *
     * @param  list<array<string, mixed>>  $lines
     * @param  array<int, ?string>  $batchIds
     */
    private function assertUniqueProductBatches(array $lines, array $batchIds): void
    {
        $seen = [];
        foreach ($lines as $i => $line) {
            $key = mb_strtolower($line['variant_id']).'|'.($batchIds[$i] ?? '');
            if (isset($seen[$key])) {
                throw ValidationException::withMessages(["lines.{$i}.variant_id" => ['Each product (and batch) may appear only once; combine the quantities.']]);
            }
            $seen[$key] = true;
        }
    }

    /**
     * Locks the stock level rows of all lines in lock-key order and returns their quantities.
     * A level is created (at zero) when missing, so a concurrent count cannot read the same
     * empty level unlocked — except for a count of zero, which leaves a missing level missing.
     *
     * @param  array<string, mixed>  $store
     * @param  list<array<string, mixed>>  $lines
     * @param  array<int, ?string>  $batchIds
     * @param  array<int, array<string, mixed>>  $counted  counted lines by index
     * @return array<string, string> quantity by lock key
     */
    private function lockLevels(string $organizationId, array $store, array $lines, array $batchIds, array $counted): array
    {
        $keys = [];
        foreach ($lines as $i => $line) {
            $key = $this->lockKey($store['id'], $line['variant_id'], $batchIds[$i]);
            $create = ! isset($counted[$i]) || ! Decimal::isZero((string) $counted[$i]['counted_quantity']);
            $keys[$key] = [$line['variant_id'], $batchIds[$i], $create || ($keys[$key][2] ?? false)];
        }
        ksort($keys, SORT_STRING);

        $quantities = [];
        foreach ($keys as $key => [$variantId, $batchId, $create]) {
            $find = fn () => StockLevel::query()
                ->where('store_id', $store['id'])
                ->where('variant_id', $variantId)
                ->when($batchId, fn ($q, $id) => $q->where('batch_id', $id), fn ($q) => $q->whereNull('batch_id'))
                ->lockForUpdate()
                ->first();

            $level = $find();
            if ($level === null && $create) {
                StockLevel::query()->insertOrIgnore([
                    'id' => (string) Str::uuid7(),
                    'organization_id' => $organizationId,
                    'branch_id' => $store['branch_id'],
                    'store_id' => $store['id'],
                    'variant_id' => $variantId,
                    'batch_id' => $batchId,
                    'quantity' => '0',
                    'average_cost' => '0',
                    'updated_at' => now(),
                ]);
                $level = $find();
            }
            $quantities[$key] = $level === null ? '0.000' : (string) $level->quantity;
        }

        return $quantities;
    }

    private function lockKey(string $storeId, string $variantId, ?string $batchId): string
    {
        // Must match StockChange::lockKey() so this and the ledger lock in the same order.
        return $storeId.'|'.$variantId.'|'.($batchId ?? '');
    }
}
