<?php

namespace App\Modules\Purchasing\Application\Services;

use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrder;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseRequisition;
use App\Modules\Purchasing\Infrastructure\Notifications\ProcurementNotification;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;

/**
 * In-app notifications of the approval workflow (SC2), sent after the transaction commits:
 * submitted requisitions and orders waiting for approval → the eligible approvers of the
 * branch (never the requester / submitter); decisions → the requester / submitter.
 */
class ProcurementNotifier
{
    public function __construct(
        private readonly ApprovalRules $rules,
        private readonly UserDirectory $users,
    ) {}

    public function requisitionSubmitted(PurchaseRequisition $requisition): void
    {
        $recipients = $this->rules->approvers($requisition->organization_id, $requisition->approval_level, $requisition->branch_id, [$requisition->requested_by]);
        $names = $this->users->names($requisition->organization_id, [$requisition->requested_by]);
        $this->send($recipients, 'purchasing.requisition_submitted', [
            'title' => "Requisition {$requisition->number} needs approval",
            'message' => sprintf('%s requested goods for %s %s (%s approval).', $names[$requisition->requested_by] ?? 'A colleague', $requisition->estimated_total, $requisition->currency, $requisition->approval_level->value),
            'requisition_id' => $requisition->id,
            'number' => $requisition->number,
            'amount' => $requisition->estimated_total,
            'approval_level' => $requisition->approval_level->value,
            'link' => '/purchasing/requisitions/'.$requisition->id,
        ]);
    }

    public function requisitionDecided(PurchaseRequisition $requisition, bool $approved): void
    {
        $recipients = $this->users->active($requisition->organization_id, [$requisition->requested_by]);
        $this->send($recipients, $approved ? 'purchasing.requisition_approved' : 'purchasing.requisition_rejected', [
            'title' => "Requisition {$requisition->number} ".($approved ? 'approved' : 'rejected'),
            'message' => $approved
                ? "Your requisition {$requisition->number} for {$requisition->estimated_total} {$requisition->currency} was approved."
                : "Your requisition {$requisition->number} was rejected: {$requisition->rejection_reason}",
            'requisition_id' => $requisition->id,
            'number' => $requisition->number,
            'link' => '/purchasing/requisitions/'.$requisition->id,
        ]);
    }

    public function orderPendingApproval(PurchaseOrder $order): void
    {
        $recipients = $this->rules->approvers($order->organization_id, $order->approval_level, $order->branch_id, [$order->created_by, $order->submitted_by]);
        $this->send($recipients, 'purchasing.order_pending_approval', [
            'title' => "Purchase order {$order->number} needs approval",
            'message' => sprintf('Purchase order %s for %s %s is waiting for %s approval.', $order->number, $order->total, $order->currency, $order->approval_level->value),
            'purchase_order_id' => $order->id,
            'number' => $order->number,
            'amount' => $order->total,
            'approval_level' => $order->approval_level->value,
            'link' => '/purchasing/orders/'.$order->id,
        ]);
    }

    public function orderDecided(PurchaseOrder $order, bool $approved): void
    {
        $recipients = $this->users->active($order->organization_id, array_values(array_filter([$order->submitted_by])));
        $this->send($recipients, $approved ? 'purchasing.order_approved' : 'purchasing.order_rejected', [
            'title' => "Purchase order {$order->number} ".($approved ? 'approved' : 'rejected'),
            'message' => $approved
                ? "Purchase order {$order->number} was approved and is now ordered."
                : "Purchase order {$order->number} was sent back to draft: {$order->rejection_reason}",
            'purchase_order_id' => $order->id,
            'number' => $order->number,
            'link' => '/purchasing/orders/'.$order->id,
        ]);
    }

    /**
     * @param  Collection<int, mixed>  $recipients
     * @param  array<string, mixed>  $payload
     */
    private function send(Collection $recipients, string $type, array $payload): void
    {
        if ($recipients->isEmpty()) {
            return;
        }
        DB::afterCommit(fn () => Notification::send($recipients, new ProcurementNotification($type, $payload)));
    }
}
