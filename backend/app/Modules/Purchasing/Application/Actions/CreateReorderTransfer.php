<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Inventory\Application\Actions\TransferStock;
use App\Modules\Inventory\Application\Contracts\ReplenishmentData;
use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Purchasing\Application\Services\PurchasingContext;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * Replenishes a store from the organization's source store (SC1) with one stock transfer
 * through the Inventory module's TransferStock. Transfers have no draft state: the transfer
 * is dispatched (in transit) right away — stock leaves the source now and the store receives
 * it with the usual receive step. Batch-tracked goods are taken first-expiry-first-out.
 */
class CreateReorderTransfer
{
    public function __construct(
        private readonly PurchasingContext $context,
        private readonly ReplenishmentData $replenishment,
        private readonly StoreAccess $storeAccess,
        private readonly BranchDirectory $branches,
        private readonly TransferStock $transfers,
    ) {}

    /**
     * @param  array{store_id: string, lines: list<array{variant_id: string, quantity: string}>}  $data
     * @return array{id: string, number: string, status: string, from_store_id: string, to_store_id: string, line_count: int}
     */
    public function __invoke(TenantUser $actor, array $data): array
    {
        $organizationId = $this->context->organizationId();
        $store = $this->storeAccess->require($actor, $data['store_id']);
        $sourceId = $this->replenishment->settings($organizationId)['source_store_id'];
        if ($sourceId === null) {
            throw new BusinessRuleViolation('NO_SOURCE_STORE', 'Choose a source store in the replenishment settings first.');
        }
        if ($sourceId === $store['id']) {
            throw new BusinessRuleViolation('SOURCE_IS_DESTINATION', 'This store is the source store; it cannot replenish itself.');
        }
        $source = $this->branches->store($sourceId, $organizationId);
        if ($source === null || ! $source['is_active'] || ! $source['branch_is_active']) {
            throw new BusinessRuleViolation('SOURCE_STORE_INACTIVE', 'The source store is inactive. Update the replenishment settings.');
        }
        if (! $actor->canAccessBranch($source['branch_id'])) {
            throw new BusinessRuleViolation('SOURCE_STORE_NOT_ACCESSIBLE', "You cannot dispatch from {$source['name']}; ask someone at {$source['branch_name']} to send the transfer.");
        }

        $transfer = $this->transfers->dispatch($actor, [
            'from_store_id' => $source['id'],
            'to_store_id' => $store['id'],
            'note' => 'Replenishment from reorder suggestions.',
            'lines' => array_map(fn (array $l) => ['variant_id' => $l['variant_id'], 'quantity' => $l['quantity']], array_values($data['lines'])),
        ], allocateBatches: true);

        return [
            'id' => $transfer->id,
            'number' => $transfer->number,
            'status' => $transfer->status->value,
            'from_store_id' => $transfer->from_store_id,
            'to_store_id' => $transfer->to_store_id,
            'line_count' => $transfer->lines()->count(),
        ];
    }
}
