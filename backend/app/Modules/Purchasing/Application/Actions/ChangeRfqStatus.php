<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Purchasing\Application\Services\ProcurementHistory;
use App\Modules\Purchasing\Application\Services\RequisitionQuantities;
use App\Modules\Purchasing\Domain\Procurement\RfqStatus;
use App\Modules\Purchasing\Infrastructure\Models\Rfq;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Support\Facades\DB;

/**
 * Ends an RFQ without an award (SC2): close (sent → closed) or cancel (draft / sent →
 * cancelled). Quantities it held for a requisition are given back to the requisition.
 */
class ChangeRfqStatus
{
    public function __construct(
        private readonly ProcurementHistory $history,
        private readonly RequisitionQuantities $quantities,
        private readonly AuditTrail $audit,
    ) {}

    public function close(Rfq $rfq, ?string $reason = null): Rfq
    {
        return $this->transition($rfq, [RfqStatus::Sent], RfqStatus::Closed, ['closed_at' => now()], $reason);
    }

    public function cancel(Rfq $rfq, ?string $reason = null): Rfq
    {
        return $this->transition($rfq, [RfqStatus::Draft, RfqStatus::Sent], RfqStatus::Cancelled, ['cancelled_at' => now()], $reason);
    }

    /**
     * @param  list<RfqStatus>  $from
     * @param  array<string, mixed>  $stamps
     */
    private function transition(Rfq $rfq, array $from, RfqStatus $to, array $stamps, ?string $reason): Rfq
    {
        return DB::transaction(function () use ($rfq, $from, $to, $stamps, $reason) {
            $locked = Rfq::query()->whereKey($rfq->id)->lockForUpdate()->firstOrFail();
            if (! in_array($locked->status, $from, true)) {
                throw new BusinessRuleViolation('INVALID_STATUS_CHANGE', "RFQ {$locked->number} is {$locked->status->value}; it cannot become {$to->value}.", ['from' => $locked->status->value, 'to' => $to->value]);
            }
            $old = $locked->status->value;
            $reason = filled($reason) ? trim((string) $reason) : null;
            $locked->forceFill(['status' => $to, ...$stamps])->save();
            $this->quantities->release($locked, [], $to === RfqStatus::Closed ? 'closed without award' : 'cancelled');
            $this->history->rfq($locked, $old, $to->value, $reason);
            $this->audit->record('rfq.'.$to->value, $locked, ['status' => $old], ['status' => $to->value, 'reason' => $reason]);

            return $locked;
        });
    }
}
