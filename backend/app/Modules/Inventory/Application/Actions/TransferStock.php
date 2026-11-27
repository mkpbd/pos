<?php

namespace App\Modules\Inventory\Application\Actions;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Inventory\Application\Contracts\SerialRegister;
use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Application\Services\StockLineRules;
use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Domain\StockChange;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Inventory\Domain\TransferStatus;
use App\Modules\Inventory\Infrastructure\Models\SerialNumberEvent;
use App\Modules\Inventory\Infrastructure\Models\StockTransfer;
use App\Modules\Inventory\Infrastructure\Models\StockTransferLine;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Two-step stock transfer between stores (also across branches):
 *  dispatch → stock leaves the source at its average cost and is "in transit";
 *  receive  → the destination books what arrived at that same cost (ST2b: short / damaged
 *             units never enter stock and are recorded as the transfer's loss);
 *  cancel   → it goes back into the source.
 * ST2b: a branch can also request stock (`requested`, nothing moves); the source dispatches
 * it (→ in transit) or rejects it, and the requesting branch can cancel it.
 * ST2d: serial-numbered lines name their serials at dispatch (in_transit in the register); they
 * arrive at the destination on receipt (such lines are received in full) or go back to the
 * source when the transfer is cancelled.
 * The transfer row is locked while it changes state, so it cannot be received twice.
 */
class TransferStock
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly StoreAccess $storeAccess,
        private readonly BranchDirectory $branches,
        private readonly StockLineRules $lineRules,
        private readonly StockLedger $ledger,
        private readonly SequenceGenerator $sequences,
        private readonly AuditTrail $audit,
        private readonly ProductDirectory $products,
        private readonly SerialRegister $serialRegister,
    ) {}

    /**
     * @param  array{from_store_id: string, to_store_id: string, note?: ?string, lines: list<array{variant_id: string, quantity: string, batch_id?: ?string, serials?: ?list<string>}>}  $data
     * @param  bool  $allocateBatches  lines without a batch of batch-tracked products are taken
     *                                 first-expiry-first-out by the ledger, one transfer line per batch
     *                                 (replenishment transfers, SC1)
     */
    public function dispatch(TenantUser $actor, array $data, bool $allocateBatches = false): StockTransfer
    {
        $organizationId = $this->tenant->requireOrganization();
        $from = $this->storeAccess->require($actor, $data['from_store_id'], 'from_store_id');
        $to = $this->branches->store($data['to_store_id'], $organizationId);

        if ($to === null || ! $to['is_active'] || ! $to['branch_is_active']) {
            throw ValidationException::withMessages(['to_store_id' => ['The destination store does not exist or is inactive.']]);
        }
        if ($to['id'] === $from['id']) {
            throw ValidationException::withMessages(['to_store_id' => ['Choose a different store than the source.']]);
        }
        $variants = $this->lineRules->validate($organizationId, $data['lines'], 'out', checkBatches: ! $allocateBatches);
        // ST2d: system replenishment transfers (allocated batches) move quantities only.
        $serials = $allocateBatches ? [] : $this->lineRules->serials($data['lines'], $variants);

        return DB::transaction(function () use ($actor, $organizationId, $from, $to, $data, $allocateBatches, $serials) {
            $transfer = StockTransfer::query()->create([
                'organization_id' => $organizationId,
                'number' => $this->sequences->next($organizationId, 'stock_transfer', 'TRF-'),
                'from_branch_id' => $from['branch_id'],
                'from_store_id' => $from['id'],
                'to_branch_id' => $to['branch_id'],
                'to_store_id' => $to['id'],
                'status' => TransferStatus::InTransit,
                'note' => $data['note'] ?? null,
                'dispatched_by' => $actor->getAuthIdentifier(),
                'dispatched_at' => now(),
            ]);

            $this->ship($transfer, array_values($data['lines']), $allocateBatches, $serials);

            $this->audit->record('stock_transfer.dispatched', $transfer, new: ['number' => $transfer->number, 'from_store_id' => $from['id'], 'to_store_id' => $to['id']]);

            return $transfer;
        });
    }

    /**
     * ST2b: the destination branch asks the source store for stock. Nothing moves.
     *
     * @param  array{from_store_id: string, to_store_id: string, note?: ?string, lines: list<array{variant_id: string, quantity: string}>}  $data
     */
    public function request(TenantUser $actor, array $data): StockTransfer
    {
        $organizationId = $this->tenant->requireOrganization();
        $to = $this->storeAccess->require($actor, $data['to_store_id'], 'to_store_id');
        $from = $this->branches->store($data['from_store_id'], $organizationId);

        if ($from === null || ! $from['is_active'] || ! $from['branch_is_active']) {
            throw ValidationException::withMessages(['from_store_id' => ['The source store does not exist or is inactive.']]);
        }
        if ($to['id'] === $from['id']) {
            throw ValidationException::withMessages(['from_store_id' => ['Choose a different store than the destination.']]);
        }
        $lines = array_map(fn (array $l) => ['variant_id' => $l['variant_id'], 'quantity' => $l['quantity']], array_values($data['lines']));
        $this->lineRules->validate($organizationId, $lines, 'out', checkBatches: false);

        return DB::transaction(function () use ($actor, $organizationId, $from, $to, $data, $lines) {
            $transfer = StockTransfer::query()->create([
                'organization_id' => $organizationId,
                'number' => $this->sequences->next($organizationId, 'stock_transfer', 'TRF-'),
                'from_branch_id' => $from['branch_id'],
                'from_store_id' => $from['id'],
                'to_branch_id' => $to['branch_id'],
                'to_store_id' => $to['id'],
                'status' => TransferStatus::Requested,
                'note' => $data['note'] ?? null,
                'requested_by' => $actor->getAuthIdentifier(),
                'requested_at' => now(),
            ]);
            foreach ($lines as $line) {
                $transfer->lines()->create([
                    'organization_id' => $organizationId,
                    'variant_id' => $line['variant_id'],
                    'quantity' => $line['quantity'],
                    'requested_quantity' => $line['quantity'],
                ]);
            }

            $this->audit->record('stock_transfer.requested', $transfer, new: ['number' => $transfer->number, 'from_store_id' => $from['id'], 'to_store_id' => $to['id']]);

            return $transfer;
        });
    }

    /**
     * ST2b: the source branch dispatches a request. Lines not listed go in full; quantity 0 drops
     * a line. Lines without a batch are allocated first-expiry-first-out.
     *
     * @param  list<array{line_id: string, quantity: string, batch_id?: ?string, serials?: ?list<string>}>  $lines
     */
    public function dispatchRequest(TenantUser $actor, StockTransfer $transfer, array $lines = []): StockTransfer
    {
        if (! $actor->canAccessBranch($transfer->from_branch_id)) {
            throw new NotFoundHttpException;
        }

        $lines = array_values($lines);

        return DB::transaction(function () use ($actor, $transfer, $lines) {
            $locked = $this->lockRequested($transfer);
            $requested = $locked->lines()->get()->keyBy('id');
            $given = [];
            $errors = [];
            foreach ($lines as $i => $entry) {
                $line = $requested[$entry['line_id']] ?? null;
                if ($line === null) {
                    $errors["lines.{$i}.line_id"] = ['This line is not on the transfer.'];
                } elseif (Decimal::compare($entry['quantity'], $line->requested_quantity ?? $line->quantity) > 0) {
                    $errors["lines.{$i}.quantity"] = ['Dispatch at most the '.($line->requested_quantity ?? $line->quantity).' requested.'];
                }
                $given[$entry['line_id']] = $i;
            }
            if ($errors !== []) {
                throw ValidationException::withMessages($errors);
            }

            // Keyed by the request body index so line errors point at the right row.
            $ship = [];
            $next = count($lines);
            foreach ($requested as $line) {
                $i = $given[$line->id] ?? null;
                $quantity = $i === null ? $line->quantity : $lines[$i]['quantity'];
                if (Decimal::isZero($quantity)) {
                    continue;
                }
                $ship[$i ?? $next++] = [
                    'variant_id' => $line->variant_id,
                    'quantity' => $quantity,
                    'batch_id' => $i === null ? null : ($lines[$i]['batch_id'] ?? null),
                    'requested_quantity' => $line->requested_quantity,
                    'serials' => $i === null ? null : ($lines[$i]['serials'] ?? null),
                ];
            }
            if ($ship === []) {
                throw ValidationException::withMessages(['lines' => ['Dispatch at least one line.']]);
            }
            $organizationId = $locked->organization_id;
            $variants = $this->lineRules->validate($organizationId, $ship, 'out', checkBatches: false);
            $serials = $this->lineRules->serials($ship, $variants);
            $chosen = array_filter($ship, fn (array $l) => $l['batch_id'] !== null);
            if ($chosen !== []) {
                $this->lineRules->validate($organizationId, $chosen, 'out');
            }

            $locked->lines()->delete();
            $this->ship($locked, array_values($ship), true, array_values(array_map(fn (int $i) => $serials[$i] ?? [], array_keys($ship))));
            $locked->forceFill([
                'status' => TransferStatus::InTransit,
                'dispatched_by' => $actor->getAuthIdentifier(),
                'dispatched_at' => now(),
            ])->save();

            $this->audit->record('stock_transfer.dispatched', $locked, new: ['number' => $locked->number, 'from_store_id' => $locked->from_store_id, 'to_store_id' => $locked->to_store_id, 'requested' => true]);

            return $locked;
        });
    }

    /**
     * ST2b: lines not listed are received in full; received + damaged ≤ sent per line. Only the
     * received units enter the destination; damaged and missing units are the transfer's loss.
     *
     * @param  list<array{line_id: string, received_quantity: string, damaged_quantity?: ?string, note?: ?string}>  $lines
     */
    public function receive(TenantUser $actor, StockTransfer $transfer, array $lines = []): StockTransfer
    {
        if (! $actor->canAccessBranch($transfer->to_branch_id)) {
            throw new NotFoundHttpException;
        }

        $lines = array_values($lines);

        return DB::transaction(function () use ($actor, $transfer, $lines) {
            $locked = $this->lockInTransit($transfer);
            $transferLines = $locked->lines()->get()->keyBy('id');
            $variants = $this->products->variants($locked->organization_id, $transferLines->pluck('variant_id')->unique()->values()->all());

            $given = [];
            $errors = [];
            foreach ($lines as $i => $entry) {
                if (! $transferLines->has($entry['line_id'])) {
                    $errors["lines.{$i}.line_id"] = ['This line is not on the transfer.'];
                }
                $given[$entry['line_id']] = $i;
            }

            $plan = [];
            foreach ($transferLines as $line) {
                $i = $given[$line->id] ?? null;
                $received = $i === null ? $line->quantity : $lines[$i]['received_quantity'];
                $damaged = $i === null ? '0' : ($lines[$i]['damaged_quantity'] ?? '0');
                $variant = $variants[$line->variant_id] ?? null;
                $path = 'lines.'.($i ?? 0);

                if (Decimal::compare(Decimal::add($received, $damaged, 3), $line->quantity) > 0) {
                    $errors["{$path}.received_quantity"] = ["Received and damaged together cannot exceed the {$line->quantity} sent."];
                } elseif ($variant !== null && ! $variant['allow_decimal'] && (! Decimal::isWhole($received) || ! Decimal::isWhole($damaged))) {
                    $errors["{$path}.received_quantity"] = ["{$variant['product_name']} is counted in whole units ({$variant['unit_code']})."];
                } elseif ($variant !== null && $variant['track_serials'] && Decimal::compare($received, $line->quantity) !== 0) {
                    // ST2b/ST2d: serial-numbered lines are received in full (every dispatched serial arrives).
                    $errors["{$path}.received_quantity"] = ["{$variant['product_name']} is serial-numbered and must be received in full."];
                }
                $plan[] = [$line, $received, $damaged, $i === null ? null : ($lines[$i]['note'] ?? null)];
            }
            if ($errors !== []) {
                throw ValidationException::withMessages($errors);
            }

            $changes = [];
            $loss = '0';
            $shortfalls = [];
            foreach ($plan as [$line, $received, $damaged, $note]) {
                $line->forceFill(['received_quantity' => $received, 'damaged_quantity' => $damaged, 'receive_note' => $note])->save();
                if (Decimal::compare($received, '0') > 0) {
                    $changes[] = new StockChange($locked->to_store_id, $line->variant_id, $line->batch_id, MovementType::TransferIn, $received, $line->unit_cost);
                }
                $lost = Decimal::sub($line->quantity, $received, 3);
                if (Decimal::compare($lost, '0') > 0) {
                    $loss = Decimal::add($loss, Decimal::mul($lost, $line->unit_cost, 2), 2);
                    $shortfalls[] = [
                        'line_id' => $line->id, 'variant_id' => $line->variant_id, 'sent' => $line->quantity,
                        'received' => Decimal::round($received, 3), 'damaged' => Decimal::round($damaged, 3),
                        'short' => Decimal::sub($lost, $damaged, 3),
                    ];
                }
            }
            $reference = new StockReference('stock_transfer', $locked->id, $locked->number);
            foreach ($this->dispatchedSerials($locked) as $variantId => $serials) {
                $this->serialRegister->arrive($locked->to_store_id, $variantId, $serials, $reference);
            }
            if ($changes !== []) {
                $this->ledger->post($changes, $reference);
            }

            $locked->forceFill([
                'status' => TransferStatus::Received,
                'completed_by' => $actor->getAuthIdentifier(),
                'completed_at' => now(),
                'loss_total' => $loss,
            ])->save();

            $this->audit->record('stock_transfer.received', $locked, new: ['number' => $locked->number, 'loss_total' => $loss, 'shortfalls' => $shortfalls]);

            return $locked;
        });
    }

    /**
     * An in-transit transfer goes back into the source (source branch); a request is withdrawn
     * by the requesting (destination) branch without moving stock.
     */
    public function cancel(TenantUser $actor, StockTransfer $transfer): StockTransfer
    {
        if ($transfer->status === TransferStatus::Requested) {
            return $this->closeRequest($actor, $transfer, TransferStatus::Cancelled, $transfer->to_branch_id);
        }
        if (! $actor->canAccessBranch($transfer->from_branch_id)) {
            throw new NotFoundHttpException;
        }

        return DB::transaction(function () use ($actor, $transfer) {
            $locked = $this->lockInTransit($transfer);

            $changes = $locked->lines()->get()->map(fn (StockTransferLine $l) => new StockChange(
                $locked->from_store_id, $l->variant_id, $l->batch_id, MovementType::TransferIn, $l->quantity, $l->unit_cost,
            ))->all();
            $reference = new StockReference('stock_transfer', $locked->id, $locked->number);
            foreach ($this->dispatchedSerials($locked) as $variantId => $serials) {
                $this->serialRegister->arrive($locked->from_store_id, $variantId, $serials, $reference);
            }
            $this->ledger->post($changes, $reference);

            $locked->forceFill([
                'status' => TransferStatus::Cancelled,
                'completed_by' => $actor->getAuthIdentifier(),
                'completed_at' => now(),
            ])->save();

            $this->audit->record('stock_transfer.cancelled', $locked, new: ['number' => $locked->number]);

            return $locked;
        });
    }

    /** ST2b: the source branch declines a request. */
    public function reject(TenantUser $actor, StockTransfer $transfer, string $reason): StockTransfer
    {
        return $this->closeRequest($actor, $transfer, TransferStatus::Rejected, $transfer->from_branch_id, $reason);
    }

    private function closeRequest(TenantUser $actor, StockTransfer $transfer, TransferStatus $status, string $branchId, ?string $reason = null): StockTransfer
    {
        if (! $actor->canAccessBranch($branchId)) {
            throw new NotFoundHttpException;
        }

        return DB::transaction(function () use ($actor, $transfer, $status, $reason) {
            $locked = $this->lockRequested($transfer);
            $locked->forceFill($status === TransferStatus::Rejected
                ? ['status' => $status, 'rejected_by' => $actor->getAuthIdentifier(), 'rejected_at' => now(), 'rejection_reason' => $reason]
                : ['status' => $status, 'completed_by' => $actor->getAuthIdentifier(), 'completed_at' => now()])->save();

            $this->audit->record('stock_transfer.'.$status->value, $locked, new: array_filter(['number' => $locked->number, 'reason' => $reason]));

            return $locked;
        });
    }

    /**
     * Takes the lines out of the source store and writes the transfer lines. ST2d: serials of
     * serial-numbered lines go in transit first (before the stock leaves: the legacy rule).
     *
     * @param  list<array{variant_id: string, quantity: string, batch_id?: ?string, requested_quantity?: ?string}>  $lines
     * @param  array<int, list<string>>  $serials  by line index
     */
    private function ship(StockTransfer $transfer, array $lines, bool $allocateBatches, array $serials = []): void
    {
        $reference = new StockReference('stock_transfer', $transfer->id, $transfer->number);
        foreach ($serials as $i => $given) {
            if ($given !== []) {
                $this->serialRegister->dispatch($transfer->from_store_id, $lines[$i]['variant_id'], $given, $reference);
            }
        }
        $changes = array_map(fn (array $l) => new StockChange(
            $transfer->from_store_id, $l['variant_id'], $l['batch_id'] ?? null, MovementType::TransferOut, $l['quantity'],
            allocateBatches: $allocateBatches && ($l['batch_id'] ?? null) === null,
        ), $lines);
        $posted = $this->ledger->post($changes, $reference);

        foreach ($lines as $i => $line) {
            $requested = $line['requested_quantity'] ?? null;
            $allocations = $allocateBatches && isset($posted[$i]) ? $posted[$i]['allocations'] : [];
            if (count($allocations) > 1 || ($allocations[0]['batch_id'] ?? null) !== null) {
                // One line per batch taken, so the destination receives the same batches;
                // the first carries the requested quantity.
                foreach ($allocations as $allocation) {
                    $transfer->lines()->create([
                        'organization_id' => $transfer->organization_id,
                        'variant_id' => $line['variant_id'],
                        'batch_id' => $allocation['batch_id'],
                        'quantity' => $allocation['quantity'],
                        'unit_cost' => $allocation['unit_cost'],
                        'requested_quantity' => $requested,
                    ]);
                    $requested = null;
                }

                continue;
            }
            $transfer->lines()->create([
                'organization_id' => $transfer->organization_id,
                'variant_id' => $line['variant_id'],
                'batch_id' => $line['batch_id'] ?? null,
                'quantity' => $line['quantity'],
                'unit_cost' => $posted[$i]['unit_cost'] ?? '0',
                'requested_quantity' => $requested,
            ]);
        }
    }

    /**
     * ST2d: the serials this transfer dispatched, by variant.
     *
     * @return array<string, list<string>>
     */
    public function dispatchedSerials(StockTransfer $transfer): array
    {
        $result = [];
        $rows = SerialNumberEvent::query()
            ->join('serial_numbers as s', 's.id', '=', 'serial_number_events.serial_number_id')
            ->where('serial_number_events.reference_type', 'stock_transfer')
            ->where('serial_number_events.reference_id', $transfer->id)
            ->where('serial_number_events.type', 'transferred_out')
            ->orderByRaw('lower(s.serial)')
            ->get(['s.variant_id', 's.serial']);
        foreach ($rows as $row) {
            $result[$row->variant_id][] = $row->serial;
        }

        return $result;
    }

    private function lockInTransit(StockTransfer $transfer): StockTransfer
    {
        $locked = StockTransfer::query()->whereKey($transfer->id)->lockForUpdate()->firstOrFail();
        if ($locked->status !== TransferStatus::InTransit) {
            throw new BusinessRuleViolation('TRANSFER_NOT_IN_TRANSIT', "Transfer {$locked->number} is already {$locked->status->value}.");
        }

        return $locked;
    }

    private function lockRequested(StockTransfer $transfer): StockTransfer
    {
        $locked = StockTransfer::query()->whereKey($transfer->id)->lockForUpdate()->firstOrFail();
        if ($locked->status !== TransferStatus::Requested) {
            throw new BusinessRuleViolation('TRANSFER_NOT_REQUESTED', "Transfer {$locked->number} is {$locked->status->value}, not requested.");
        }

        return $locked;
    }
}
