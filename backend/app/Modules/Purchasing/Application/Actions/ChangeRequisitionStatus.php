<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Purchasing\Application\Services\ApprovalRules;
use App\Modules\Purchasing\Application\Services\ProcurementHistory;
use App\Modules\Purchasing\Application\Services\ProcurementNotifier;
use App\Modules\Purchasing\Domain\Procurement\ApprovalLevel;
use App\Modules\Purchasing\Domain\Procurement\RequisitionStatus;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseRequisition;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseRequisitionLine;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * Requisition workflow (SC2), each step under a row lock, audited and appended to the status
 * history:
 * - submit (requester or purchases.manage): the approval level is decided from the estimated
 *   total and the current limits; at or below the auto-approve limit the requisition is
 *   approved at once by the system;
 * - approve / reject (reason required): an eligible approver of the branch, never the requester;
 * - cancel: the requester while draft or submitted, purchases.manage until something was converted.
 */
class ChangeRequisitionStatus
{
    public function __construct(
        private readonly ApprovalRules $rules,
        private readonly ProcurementHistory $history,
        private readonly ProcurementNotifier $notifier,
        private readonly AuditTrail $audit,
    ) {}

    public function submit(TenantUser $actor, PurchaseRequisition $requisition): PurchaseRequisition
    {
        return DB::transaction(function () use ($actor, $requisition) {
            $locked = $this->lock($requisition);
            if ($locked->requested_by !== $this->id($actor) && ! $this->rules->has($actor, 'purchases.manage')) {
                throw new AuthorizationException('Only the requester or a purchasing manager can submit this requisition.');
            }
            $this->expect($locked, [RequisitionStatus::Draft], RequisitionStatus::Submitted);
            if (! $locked->lines()->exists()) {
                throw new BusinessRuleViolation('REQUISITION_EMPTY', 'Add at least one line before submitting.');
            }

            $level = $this->rules->levelFor($locked->estimated_total);
            $locked->forceFill(['status' => RequisitionStatus::Submitted, 'approval_level' => $level, 'submitted_at' => now()])->save();
            $this->history->requisition($locked, RequisitionStatus::Draft->value, RequisitionStatus::Submitted->value);
            $this->audit->record('purchase_requisition.submitted', $locked, ['status' => 'draft'], ['status' => 'submitted', 'approval_level' => $level->value, 'estimated_total' => $locked->estimated_total]);

            if ($level === ApprovalLevel::None) {
                $locked->forceFill(['status' => RequisitionStatus::Approved, 'approved_at' => now(), 'approved_by' => null])->save();
                $this->history->requisition($locked, RequisitionStatus::Submitted->value, RequisitionStatus::Approved->value, 'Approved automatically: at or below the auto-approve limit.', system: true);
                $this->audit->record('purchase_requisition.auto_approved', $locked, ['status' => 'submitted'], ['status' => 'approved', 'approved_by' => 'system']);
            } else {
                $this->notifier->requisitionSubmitted($locked);
            }

            return $locked;
        });
    }

    public function approve(TenantUser $actor, PurchaseRequisition $requisition): PurchaseRequisition
    {
        return DB::transaction(function () use ($actor, $requisition) {
            $locked = $this->lock($requisition);
            $this->expect($locked, [RequisitionStatus::Submitted], RequisitionStatus::Approved);
            $this->rules->assertCanApprove($actor, $locked->approval_level, $locked->branch_id, [$locked->requested_by], $locked->estimated_total);

            $locked->forceFill(['status' => RequisitionStatus::Approved, 'approved_by' => $this->id($actor), 'approved_at' => now()])->save();
            $this->history->requisition($locked, RequisitionStatus::Submitted->value, RequisitionStatus::Approved->value);
            $this->audit->record('purchase_requisition.approved', $locked, ['status' => 'submitted'], ['status' => 'approved', 'approval_level' => $locked->approval_level->value]);
            $this->notifier->requisitionDecided($locked, true);

            return $locked;
        });
    }

    public function reject(TenantUser $actor, PurchaseRequisition $requisition, string $reason): PurchaseRequisition
    {
        return DB::transaction(function () use ($actor, $requisition, $reason) {
            $locked = $this->lock($requisition);
            $this->expect($locked, [RequisitionStatus::Submitted], RequisitionStatus::Rejected);
            $this->rules->assertCanApprove($actor, $locked->approval_level, $locked->branch_id, [$locked->requested_by], $locked->estimated_total);

            $reason = trim($reason);
            $locked->forceFill(['status' => RequisitionStatus::Rejected, 'rejected_by' => $this->id($actor), 'rejected_at' => now(), 'rejection_reason' => $reason])->save();
            $this->history->requisition($locked, RequisitionStatus::Submitted->value, RequisitionStatus::Rejected->value, $reason);
            $this->audit->record('purchase_requisition.rejected', $locked, ['status' => 'submitted'], ['status' => 'rejected', 'reason' => $reason]);
            $this->notifier->requisitionDecided($locked, false);

            return $locked;
        });
    }

    public function cancel(TenantUser $actor, PurchaseRequisition $requisition, ?string $reason): PurchaseRequisition
    {
        return DB::transaction(function () use ($actor, $requisition, $reason) {
            $locked = $this->lock($requisition);
            $manager = $this->rules->has($actor, 'purchases.manage');
            $requester = $locked->requested_by === $this->id($actor);
            if (! $manager && ! $requester) {
                throw new AuthorizationException('Only the requester or a purchasing manager can cancel this requisition.');
            }
            $allowed = $manager
                ? [RequisitionStatus::Draft, RequisitionStatus::Submitted, RequisitionStatus::Approved]
                : [RequisitionStatus::Draft, RequisitionStatus::Submitted];
            $this->expect($locked, $allowed, RequisitionStatus::Cancelled);
            $converted = $locked->lines()->get()->contains(fn (PurchaseRequisitionLine $l) => ! Decimal::isZero($l->converted_quantity));
            if ($converted) {
                throw new BusinessRuleViolation('INVALID_STATUS_CHANGE', "Requisition {$locked->number} was already partly converted; cancel its purchase orders or RFQ instead.");
            }

            $from = $locked->status->value;
            $reason = filled($reason) ? trim((string) $reason) : null;
            $locked->forceFill(['status' => RequisitionStatus::Cancelled, 'cancelled_by' => $this->id($actor), 'cancelled_at' => now(), 'cancellation_reason' => $reason])->save();
            $this->history->requisition($locked, $from, RequisitionStatus::Cancelled->value, $reason);
            $this->audit->record('purchase_requisition.cancelled', $locked, ['status' => $from], ['status' => 'cancelled', 'reason' => $reason]);

            return $locked;
        });
    }

    private function lock(PurchaseRequisition $requisition): PurchaseRequisition
    {
        return PurchaseRequisition::query()->whereKey($requisition->id)->lockForUpdate()->firstOrFail();
    }

    /**
     * @param  list<RequisitionStatus>  $from
     */
    private function expect(PurchaseRequisition $requisition, array $from, RequisitionStatus $to): void
    {
        if (! in_array($requisition->status, $from, true)) {
            throw new BusinessRuleViolation('INVALID_STATUS_CHANGE', "Requisition {$requisition->number} is {$requisition->status->value}; it cannot become {$to->value}.", [
                'from' => $requisition->status->value,
                'to' => $to->value,
            ]);
        }
    }

    private function id(TenantUser $actor): string
    {
        return (string) $actor->getAuthIdentifier();
    }
}
