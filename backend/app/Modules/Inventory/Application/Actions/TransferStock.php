<?php

namespace App\Modules\Inventory\Application\Actions;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Application\Services\StockLineRules;
use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Domain\StockChange;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Inventory\Domain\TransferStatus;
use App\Modules\Inventory\Infrastructure\Models\StockTransfer;
use App\Modules\Inventory\Infrastructure\Models\StockTransferLine;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Two-step stock transfer between stores (also across branches):
 *  dispatch → stock leaves the source at its average cost and is "in transit";
 *  receive  → the destination books it at that same cost;
 *  cancel   → it goes back into the source.
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
    ) {}

    /**
     * @param  array{from_store_id: string, to_store_id: string, note?: ?string, lines: list<array{variant_id: string, quantity: string, batch_id?: ?string}>}  $data
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
        $this->lineRules->validate($organizationId, $data['lines'], 'out', checkBatches: ! $allocateBatches);

        return DB::transaction(function () use ($actor, $organizationId, $from, $to, $data, $allocateBatches) {
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

            $lines = array_values($data['lines']);
            $changes = array_map(fn (array $l) => new StockChange(
                $from['id'], $l['variant_id'], $l['batch_id'] ?? null, MovementType::TransferOut, $l['quantity'],
                allocateBatches: $allocateBatches && ($l['batch_id'] ?? null) === null,
            ), $lines);
            $posted = $this->ledger->post($changes, new StockReference('stock_transfer', $transfer->id, $transfer->number));

            foreach ($lines as $i => $line) {
                $allocations = $allocateBatches && isset($posted[$i]) ? $posted[$i]['allocations'] : [];
                if (count($allocations) > 1 || ($allocations[0]['batch_id'] ?? null) !== null) {
                    // One line per batch taken, so the destination receives the same batches.
                    foreach ($allocations as $allocation) {
                        $transfer->lines()->create([
                            'organization_id' => $organizationId,
                            'variant_id' => $line['variant_id'],
                            'batch_id' => $allocation['batch_id'],
                            'quantity' => $allocation['quantity'],
                            'unit_cost' => $allocation['unit_cost'],
                        ]);
                    }

                    continue;
                }
                $transfer->lines()->create([
                    'organization_id' => $organizationId,
                    'variant_id' => $line['variant_id'],
                    'batch_id' => $line['batch_id'] ?? null,
                    'quantity' => $line['quantity'],
                    'unit_cost' => $posted[$i]['unit_cost'] ?? '0',
                ]);
            }

            $this->audit->record('stock_transfer.dispatched', $transfer, new: ['number' => $transfer->number, 'from_store_id' => $from['id'], 'to_store_id' => $to['id']]);

            return $transfer;
        });
    }

    public function receive(TenantUser $actor, StockTransfer $transfer): StockTransfer
    {
        if (! $actor->canAccessBranch($transfer->to_branch_id)) {
            throw new NotFoundHttpException;
        }

        return $this->complete($actor, $transfer, TransferStatus::Received, $transfer->to_store_id);
    }

    public function cancel(TenantUser $actor, StockTransfer $transfer): StockTransfer
    {
        if (! $actor->canAccessBranch($transfer->from_branch_id)) {
            throw new NotFoundHttpException;
        }

        return $this->complete($actor, $transfer, TransferStatus::Cancelled, $transfer->from_store_id);
    }

    private function complete(TenantUser $actor, StockTransfer $transfer, TransferStatus $status, string $intoStoreId): StockTransfer
    {
        return DB::transaction(function () use ($actor, $transfer, $status, $intoStoreId) {
            $locked = StockTransfer::query()->whereKey($transfer->id)->lockForUpdate()->firstOrFail();
            if ($locked->status !== TransferStatus::InTransit) {
                throw new BusinessRuleViolation('TRANSFER_NOT_IN_TRANSIT', "Transfer {$locked->number} is already {$locked->status->value}.");
            }

            $changes = $locked->lines()->get()->map(fn (StockTransferLine $l) => new StockChange(
                $intoStoreId, $l->variant_id, $l->batch_id, MovementType::TransferIn, $l->quantity, $l->unit_cost,
            ))->all();
            $this->ledger->post($changes, new StockReference('stock_transfer', $locked->id, $locked->number));

            $locked->forceFill([
                'status' => $status,
                'completed_by' => $actor->getAuthIdentifier(),
                'completed_at' => now(),
            ])->save();

            $this->audit->record('stock_transfer.'.$status->value, $locked, new: ['number' => $locked->number]);

            return $locked;
        });
    }
}
