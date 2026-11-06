<?php

namespace App\Modules\Purchasing\Application\Services;

use App\Modules\Purchasing\Domain\Procurement\RequisitionStatus;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrder;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrderLine;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseRequisition;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseRequisitionLine;
use App\Modules\Purchasing\Infrastructure\Models\Rfq;
use App\Modules\Purchasing\Infrastructure\Models\RfqLine;
use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * Keeps a requisition's converted quantities and status in step (SC2, inside the caller's
 * transaction): a requisition is `converted` once every line is fully turned into purchase
 * orders or handed to an RFQ. Quantities an RFQ does not award (closed, cancelled or
 * partly awarded) and the unreceived quantities of a cancelled purchase order are given
 * back, which reopens a converted requisition as approved.
 */
class RequisitionQuantities
{
    public function __construct(private readonly ProcurementHistory $history) {}

    /**
     * Updates the status after lines were converted (approved → converted when complete).
     */
    public function refresh(PurchaseRequisition $requisition, ?string $note = null): void
    {
        $lines = $requisition->lines()->get();
        $complete = $lines->isNotEmpty() && $lines->every(fn (PurchaseRequisitionLine $l) => Decimal::compare($l->converted_quantity, $l->quantity) >= 0);

        if ($complete && $requisition->status === RequisitionStatus::Approved) {
            $requisition->forceFill(['status' => RequisitionStatus::Converted, 'converted_at' => now()])->save();
            $this->history->requisition($requisition, RequisitionStatus::Approved->value, RequisitionStatus::Converted->value, $note);
        } elseif (! $complete && $requisition->status === RequisitionStatus::Converted) {
            $requisition->forceFill(['status' => RequisitionStatus::Approved, 'converted_at' => null])->save();
            $this->history->requisition($requisition, RequisitionStatus::Converted->value, RequisitionStatus::Approved->value, $note, system: true);
        }
    }

    /**
     * Gives back what an RFQ did not award to its requisition's lines.
     *
     * @param  array<string, string>  $awarded  RFQ line id => awarded quantity
     */
    public function release(Rfq $rfq, array $awarded, string $why): void
    {
        if ($rfq->requisition_id === null) {
            return;
        }

        $back = [];
        foreach ($rfq->lines()->whereNotNull('requisition_line_id')->get() as $rfqLine) {
            /** @var RfqLine $rfqLine */
            $back[$rfqLine->requisition_line_id] = Decimal::add($back[$rfqLine->requisition_line_id] ?? '0', Decimal::sub($rfqLine->quantity, $awarded[$rfqLine->id] ?? '0', 3), 3);
        }

        $this->giveBack($back, "Quantities released by {$rfq->number} ({$why}).", [$rfq->requisition_id]);
    }

    /**
     * Gives back what a cancelled purchase order will no longer deliver: each requisition-linked
     * line's unreceived quantity (ordered − received). Returns what was released per
     * requisition line (empty when the order is not linked to a requisition).
     *
     * @return array<string, string> requisition line id => released quantity
     */
    public function releaseFromOrder(PurchaseOrder $order, string $why): array
    {
        $back = [];
        foreach ($order->lines()->whereNotNull('requisition_line_id')->get() as $orderLine) {
            /** @var PurchaseOrderLine $orderLine */
            $back[$orderLine->requisition_line_id] = Decimal::add($back[$orderLine->requisition_line_id] ?? '0', Decimal::sub($orderLine->quantity, $orderLine->received_quantity, 3), 3);
        }

        return $this->giveBack($back, "Quantities released by {$order->number} ({$why}).");
    }

    /**
     * Subtracts quantities from requisition lines' converted quantity (never below zero) under
     * row locks — requisitions first, then their lines, each in id order, the same order
     * conversion locks them — and refreshes each affected requisition's status.
     *
     * @param  array<string, string>  $back  requisition line id => quantity to give back
     * @param  list<string>  $requisitionIds  requisitions to lock even if no line is released
     * @return array<string, string> requisition line id => quantity actually released
     */
    private function giveBack(array $back, string $note, array $requisitionIds = []): array
    {
        $back = array_filter($back, fn (string $quantity) => Decimal::compare($quantity, '0') > 0);
        $lineIds = array_keys($back);
        sort($lineIds);
        $requisitionIds = array_merge($requisitionIds, $lineIds === [] ? [] : PurchaseRequisitionLine::query()->whereIn('id', $lineIds)->pluck('purchase_requisition_id')->all());
        $requisitionIds = array_values(array_unique($requisitionIds));
        sort($requisitionIds);
        if ($requisitionIds === []) {
            return [];
        }

        $requisitions = PurchaseRequisition::query()->whereIn('id', $requisitionIds)->orderBy('id')->lockForUpdate()->get()->keyBy('id');
        $lines = $lineIds === [] ? collect() : PurchaseRequisitionLine::query()->whereIn('id', $lineIds)->orderBy('id')->lockForUpdate()->get();

        $released = [];
        $touched = [];
        foreach ($lines as $line) {
            /** @var PurchaseRequisitionLine $line */
            $quantity = Decimal::min($back[$line->id], $line->converted_quantity);
            if (Decimal::compare($quantity, '0') <= 0) {
                continue;
            }
            $line->forceFill(['converted_quantity' => Decimal::sub($line->converted_quantity, $quantity, 3)])->save();
            $released[$line->id] = Decimal::round($quantity, 3);
            $touched[$line->purchase_requisition_id] = true;
        }

        foreach (array_keys($touched) as $requisitionId) {
            $requisition = $requisitions->get($requisitionId);
            if ($requisition instanceof PurchaseRequisition) {
                $this->refresh($requisition, $note);
            }
        }

        return $released;
    }
}
