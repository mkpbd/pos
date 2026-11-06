<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Purchasing\Application\Services\ApprovalRules;
use App\Modules\Purchasing\Application\Services\ProcurementHistory;
use App\Modules\Purchasing\Application\Services\ProcurementNotifier;
use App\Modules\Purchasing\Application\Services\RequisitionQuantities;
use App\Modules\Purchasing\Domain\Procurement\ApprovalLevel;
use App\Modules\Purchasing\Domain\Procurement\ApprovalPolicy;
use App\Modules\Purchasing\Domain\PurchaseOrderStatus;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrder;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrderLine;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Facades\DB;

/**
 * Purchase order status changes:
 * - place ("mark ordered", Phase 4): draft → ordered, only when no approval is needed;
 * - submit (SC2): draft → ordered when no approval is needed, else → pending_approval;
 * - approve / reject (SC2): pending_approval → ordered / back to draft with the reason;
 * - cancel: draft, pending_approval or ordered → cancelled while nothing was received; lines
 *   converted from a requisition (directly or via an RFQ award) give their unreceived
 *   quantity back to it, reopening a converted requisition as approved.
 *
 * No approval is needed when the organization does not require PO approval, the total is at
 * or below the auto-approve limit, or the order is pre-approved (created from an approved
 * requisition or an RFQ award for one) and its total stays within 5 % of the approved amount.
 */
class ChangePurchaseOrderStatus
{
    public function __construct(
        private readonly AuditTrail $audit,
        private readonly ApprovalRules $rules,
        private readonly ProcurementHistory $history,
        private readonly ProcurementNotifier $notifier,
        private readonly RequisitionQuantities $quantities,
    ) {}

    public function place(PurchaseOrder $order): PurchaseOrder
    {
        return DB::transaction(function () use ($order) {
            $locked = $this->lock($order);
            $this->expect($locked, [PurchaseOrderStatus::Draft], PurchaseOrderStatus::Ordered);
            [$level, $why] = $this->approvalNeeded($locked);
            if ($level !== null) {
                throw new BusinessRuleViolation('APPROVAL_REQUIRED', "Purchase order {$locked->number} needs {$level->value} approval; submit it for approval instead.", [
                    'approval_level' => $level->value,
                    'total' => $locked->total,
                ]);
            }

            return $this->toOrdered($locked, PurchaseOrderStatus::Draft, $why);
        });
    }

    public function submit(TenantUser $actor, PurchaseOrder $order): PurchaseOrder
    {
        return DB::transaction(function () use ($actor, $order) {
            $locked = $this->lock($order);
            $this->expect($locked, [PurchaseOrderStatus::Draft], PurchaseOrderStatus::PendingApproval);
            [$level, $why] = $this->approvalNeeded($locked);
            $locked->forceFill(['submitted_by' => (string) $actor->getAuthIdentifier(), 'submitted_at' => now()]);

            if ($level === null) {
                return $this->toOrdered($locked, PurchaseOrderStatus::Draft, $why);
            }

            $locked->forceFill(['status' => PurchaseOrderStatus::PendingApproval, 'approval_level' => $level])->save();
            $this->history->order($locked, PurchaseOrderStatus::Draft->value, PurchaseOrderStatus::PendingApproval->value, $why);
            $this->audit->record('purchase_order.submitted', $locked, ['status' => 'draft'], ['status' => 'pending_approval', 'approval_level' => $level->value, 'total' => $locked->total]);
            $this->notifier->orderPendingApproval($locked);

            return $locked;
        });
    }

    public function approve(TenantUser $actor, PurchaseOrder $order): PurchaseOrder
    {
        return DB::transaction(function () use ($actor, $order) {
            $locked = $this->lock($order);
            $this->expect($locked, [PurchaseOrderStatus::PendingApproval], PurchaseOrderStatus::Ordered);
            $level = $locked->approval_level ?? ApprovalLevel::High;
            $this->rules->assertCanApprove($actor, $level, $locked->branch_id, [$locked->created_by, $locked->submitted_by], $locked->total);

            $locked->forceFill(['status' => PurchaseOrderStatus::Ordered, 'ordered_at' => now(), 'approved_by' => (string) $actor->getAuthIdentifier(), 'approved_at' => now()])->save();
            $this->history->order($locked, PurchaseOrderStatus::PendingApproval->value, PurchaseOrderStatus::Ordered->value, 'Approved.');
            $this->audit->record('purchase_order.approved', $locked, ['status' => 'pending_approval'], ['status' => 'ordered', 'approval_level' => $level->value]);
            $this->notifier->orderDecided($locked, true);

            return $locked;
        });
    }

    public function reject(TenantUser $actor, PurchaseOrder $order, string $reason): PurchaseOrder
    {
        return DB::transaction(function () use ($actor, $order, $reason) {
            $locked = $this->lock($order);
            $this->expect($locked, [PurchaseOrderStatus::PendingApproval], PurchaseOrderStatus::Draft);
            $level = $locked->approval_level ?? ApprovalLevel::High;
            $this->rules->assertCanApprove($actor, $level, $locked->branch_id, [$locked->created_by, $locked->submitted_by], $locked->total);

            $reason = trim($reason);
            $locked->forceFill([
                'status' => PurchaseOrderStatus::Draft,
                'rejected_by' => (string) $actor->getAuthIdentifier(),
                'rejected_at' => now(),
                'rejection_reason' => $reason,
            ])->save();
            $this->history->order($locked, PurchaseOrderStatus::PendingApproval->value, PurchaseOrderStatus::Draft->value, 'Rejected: '.$reason);
            $this->audit->record('purchase_order.rejected', $locked, ['status' => 'pending_approval'], ['status' => 'draft', 'reason' => $reason]);
            $this->notifier->orderDecided($locked, false);

            return $locked;
        });
    }

    public function cancel(PurchaseOrder $order): PurchaseOrder
    {
        return DB::transaction(function () use ($order) {
            $locked = $this->lock($order);
            $this->expect($locked, [PurchaseOrderStatus::Draft, PurchaseOrderStatus::PendingApproval, PurchaseOrderStatus::Ordered], PurchaseOrderStatus::Cancelled);
            $received = $locked->lines()->get()->contains(fn (PurchaseOrderLine $l) => ! Decimal::isZero($l->received_quantity));
            if ($received) {
                throw new BusinessRuleViolation('INVALID_STATUS_CHANGE', 'Goods were already received against this order.');
            }

            $old = $locked->status->value;
            $locked->forceFill(['status' => PurchaseOrderStatus::Cancelled, 'cancelled_at' => now()])->save();
            $this->history->order($locked, $old, PurchaseOrderStatus::Cancelled->value);
            $released = $this->quantities->releaseFromOrder($locked, 'cancelled');
            $this->audit->record('purchase_order.cancelled', $locked, ['status' => $old], ['status' => 'cancelled'] + ($released === [] ? [] : ['released_to_requisition' => $released]));

            return $locked;
        });
    }

    /**
     * Whether a draft needs approval now: [level, note] — level NULL means it can be ordered.
     *
     * @return array{0: ?ApprovalLevel, 1: string}
     */
    public function approvalNeeded(PurchaseOrder $order): array
    {
        $settings = $this->rules->settings($order->organization_id);
        if (! $settings['require_po_approval']) {
            return [null, 'Purchase order approval is not required.'];
        }
        $level = $this->rules->levelFor($order->total, $settings);
        if ($level === ApprovalLevel::None) {
            return [null, 'At or below the auto-approve limit.'];
        }
        if (ApprovalPolicy::withinPreApproval($order->total, $order->approved_amount)) {
            return [null, "Pre-approved: within 5 % of the approved {$order->approved_amount}."];
        }

        return [$level, $order->approved_amount === null
            ? "Needs {$level->value} approval."
            : 'Needs '.$level->value.' approval: the total exceeds the pre-approved '.$order->approved_amount.' by more than 5 %.'];
    }

    private function toOrdered(PurchaseOrder $locked, PurchaseOrderStatus $from, string $note): PurchaseOrder
    {
        $locked->forceFill(['status' => PurchaseOrderStatus::Ordered, 'ordered_at' => now()])->save();
        $this->history->order($locked, $from->value, PurchaseOrderStatus::Ordered->value, $note);
        $this->audit->record('purchase_order.ordered', $locked, ['status' => $from->value], ['status' => 'ordered']);

        return $locked;
    }

    private function lock(PurchaseOrder $order): PurchaseOrder
    {
        return PurchaseOrder::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
    }

    /**
     * @param  list<PurchaseOrderStatus>  $from
     */
    private function expect(PurchaseOrder $order, array $from, PurchaseOrderStatus $to): void
    {
        if (! in_array($order->status, $from, true)) {
            throw new BusinessRuleViolation('INVALID_STATUS_CHANGE', "Purchase order {$order->number} is {$order->status->value}; it cannot become {$to->value}.");
        }
    }
}
