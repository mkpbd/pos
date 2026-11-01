<?php

namespace App\Modules\Orders\Application\Actions;

use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Domain\StockChange;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Domain\ShipmentStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderStatusChange;
use App\Modules\Orders\Infrastructure\Models\Shipment;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Support\Facades\DB;

/**
 * Cancels an unpaid web order (staff, the customer — E9 — or the expiry job with no actor): its stock goes back
 * to the exact batches it left from, at the cost it left with (`online_order_cancel`), in the
 * same transaction as the status change. The order row is locked first, so a second cancel
 * (or a cancel racing the expiry job) finds it cancelled — INVALID_STATUS_TRANSITION, never a
 * second restock. Paid orders need a refund (E10): ORDER_PAID. A shipped order can be
 * cancelled only when its parcel was returned to the sender (E10a).
 */
class CancelOrder
{
    public function __construct(
        private readonly StockLedger $stock,
        private readonly AuditTrail $audit,
    ) {}

    public function __invoke(Order $order, ?string $reason, ?string $actorId): Order
    {
        return DB::transaction(function () use ($order, $reason, $actorId) {
            /** @var Order $locked */
            $locked = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();

            return $this->cancelLocked($locked, $reason, $actorId);
        });
    }

    /**
     * Cancels an order the caller already locked inside its transaction. `$actorType`
     * (customer | staff | system) defaults to staff with an actor, system without.
     */
    public function cancelLocked(Order $locked, ?string $reason, ?string $actorId, ?string $actorType = null): Order
    {
        $actorType ??= $actorId === null ? 'system' : 'staff';
        $from = $locked->status;
        if (! self::returnedToSender($locked)) {
            $from->assertCanBecome(OrderStatus::Cancelled, $locked->number);
        }
        if ($locked->payment_status->isPaid()) {
            throw new BusinessRuleViolation('ORDER_PAID', "{$locked->number} is paid; refund it instead of cancelling.");
        }

        $changes = [];
        foreach ($locked->lines()->with('stock')->get() as $line) {
            foreach ($line->stock as $allocation) {
                $changes[] = new StockChange($locked->store_id, $line->variant_id, $allocation->batch_id, MovementType::OnlineOrderCancel, (string) $allocation->quantity, (string) $allocation->unit_cost);
            }
        }
        $this->stock->post($changes, new StockReference('online_order_cancellation', $locked->id, $locked->number));

        $now = now();
        $locked->update([
            'status' => OrderStatus::Cancelled,
            'cancelled_at' => $now,
            'cancelled_by' => $actorId,
            'cancel_reason' => $reason,
            'expires_at' => null,
        ]);
        OrderStatusChange::query()->create([
            'organization_id' => $locked->organization_id,
            'order_id' => $locked->id,
            'from_status' => $from,
            'to_status' => OrderStatus::Cancelled,
            'note' => $reason === null ? null : mb_substr($reason, 0, 255),
            'actor_user_id' => $actorId,
            'actor_type' => $actorType,
            'created_at' => $now,
        ]);
        $this->audit->record('web_order.cancelled', $locked, ['status' => $from->value], [
            'status' => OrderStatus::Cancelled->value,
            'number' => $locked->number,
            'reason' => $reason,
            'by' => $actorType,
        ]);

        return $locked;
    }

    /**
     * A shipped order whose parcel came back to the sender (E10a): it may be cancelled — with
     * the same exact restock — when it is unpaid (checked by the caller).
     */
    public static function returnedToSender(Order $order): bool
    {
        return $order->status === OrderStatus::Shipped
            && Shipment::query()->where('order_id', $order->id)->where('status', ShipmentStatus::Returned)->exists();
    }
}
