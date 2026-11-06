<?php

namespace App\Modules\Purchasing\Application\Services;

use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrder;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrderStatusChange;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseRequisition;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseRequisitionStatusChange;
use App\Modules\Purchasing\Infrastructure\Models\Rfq;
use App\Modules\Purchasing\Infrastructure\Models\RfqStatusChange;
use App\Modules\Shared\Application\Support\StaffActor;

/**
 * Appends status history rows (SC2). The actor is the staff user of the request unless the
 * step was taken by the system (automatic approval, quantities released by an RFQ).
 */
class ProcurementHistory
{
    public function requisition(PurchaseRequisition $requisition, ?string $from, string $to, ?string $note = null, bool $system = false): void
    {
        PurchaseRequisitionStatusChange::query()->create([
            'organization_id' => $requisition->organization_id,
            'purchase_requisition_id' => $requisition->id,
            'from_status' => $from,
            'to_status' => $to,
            'note' => $note === null ? null : mb_substr($note, 0, 500),
            'actor_user_id' => $system ? null : StaffActor::id(),
            'created_at' => now(),
        ]);
    }

    public function order(PurchaseOrder $order, ?string $from, string $to, ?string $note = null, bool $system = false): void
    {
        PurchaseOrderStatusChange::query()->create([
            'organization_id' => $order->organization_id,
            'purchase_order_id' => $order->id,
            'from_status' => $from,
            'to_status' => $to,
            'note' => $note === null ? null : mb_substr($note, 0, 500),
            'actor_user_id' => $system ? null : StaffActor::id(),
            'created_at' => now(),
        ]);
    }

    public function rfq(Rfq $rfq, ?string $from, string $to, ?string $note = null): void
    {
        RfqStatusChange::query()->create([
            'organization_id' => $rfq->organization_id,
            'rfq_id' => $rfq->id,
            'from_status' => $from,
            'to_status' => $to,
            'note' => $note === null ? null : mb_substr($note, 0, 500),
            'actor_user_id' => StaffActor::id(),
            'created_at' => now(),
        ]);
    }
}
