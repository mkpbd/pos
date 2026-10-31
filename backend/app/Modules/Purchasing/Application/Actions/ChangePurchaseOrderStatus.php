<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Purchasing\Domain\PurchaseOrderStatus;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrder;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrderLine;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Facades\DB;

/**
 * draft → ordered (sent to the supplier); draft/ordered → cancelled while nothing was received.
 */
class ChangePurchaseOrderStatus
{
    public function __construct(private readonly AuditTrail $audit) {}

    public function place(PurchaseOrder $order): PurchaseOrder
    {
        return $this->transition($order, [PurchaseOrderStatus::Draft], PurchaseOrderStatus::Ordered, ['ordered_at' => now()]);
    }

    public function cancel(PurchaseOrder $order): PurchaseOrder
    {
        return $this->transition($order, [PurchaseOrderStatus::Draft, PurchaseOrderStatus::Ordered], PurchaseOrderStatus::Cancelled, ['cancelled_at' => now()]);
    }

    /**
     * @param  list<PurchaseOrderStatus>  $from
     * @param  array<string, mixed>  $stamps
     */
    private function transition(PurchaseOrder $order, array $from, PurchaseOrderStatus $to, array $stamps): PurchaseOrder
    {
        return DB::transaction(function () use ($order, $from, $to, $stamps) {
            $locked = PurchaseOrder::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();

            if (! in_array($locked->status, $from, true)) {
                throw new BusinessRuleViolation('INVALID_STATUS_CHANGE', "Purchase order {$locked->number} is {$locked->status->value}; it cannot become {$to->value}.");
            }
            $received = $locked->lines()->get()->contains(fn (PurchaseOrderLine $l) => ! Decimal::isZero($l->received_quantity));
            if ($to === PurchaseOrderStatus::Cancelled && $received) {
                throw new BusinessRuleViolation('INVALID_STATUS_CHANGE', 'Goods were already received against this order.');
            }

            $old = $locked->status->value;
            $locked->forceFill(['status' => $to, ...$stamps])->save();
            $this->audit->record('purchase_order.'.$to->value, $locked, ['status' => $old], ['status' => $to->value]);

            return $locked;
        });
    }
}
