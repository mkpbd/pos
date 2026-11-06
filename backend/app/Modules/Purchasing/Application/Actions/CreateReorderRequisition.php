<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Purchasing\Infrastructure\Models\PurchaseRequisition;
use App\Modules\Shared\Application\Contracts\TenantUser;
use Illuminate\Support\Facades\DB;

/**
 * Raises a purchase requisition from selected reorder suggestions (SC2) — the route for
 * branch staff without `purchases.manage`: one draft requisition for the store, the
 * suggestion's supplier as the suggested supplier, its unit cost as the estimate (prefilled
 * when omitted), optionally submitted at once. Idempotent route; one transaction.
 */
class CreateReorderRequisition
{
    public function __construct(
        private readonly SaveRequisition $save,
        private readonly ChangeRequisitionStatus $status,
    ) {}

    /**
     * @param  array{store_id: string, needed_by?: ?string, notes?: ?string, submit?: ?bool, lines: list<array{variant_id: string, quantity: string, supplier_id?: ?string, unit_cost?: ?string}>}  $data
     */
    public function __invoke(TenantUser $actor, array $data): PurchaseRequisition
    {
        return DB::transaction(function () use ($actor, $data) {
            $requisition = ($this->save)($actor, null, [
                'store_id' => $data['store_id'],
                'needed_by' => $data['needed_by'] ?? null,
                'notes' => $data['notes'] ?? null,
                'lines' => array_map(fn (array $l) => [
                    'variant_id' => $l['variant_id'],
                    'quantity' => $l['quantity'],
                    'estimated_unit_cost' => $l['unit_cost'] ?? null,
                    'suggested_supplier_id' => $l['supplier_id'] ?? null,
                ], array_values($data['lines'])),
            ], 'Raised from reorder suggestions.');

            return ($data['submit'] ?? false) ? $this->status->submit($actor, $requisition) : $requisition;
        });
    }
}
