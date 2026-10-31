<?php

namespace App\Modules\Orders\Application\Actions;

use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Domain\StockChange;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Domain\PaymentStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderStatusChange;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Support\Facades\DB;

/**
 * Cancels an unpaid web order (staff, or the expiry job with no actor): its stock goes back
 * to the exact batches it left from, at the cost it left with (`online_order_cancel`), in the
 * same transaction as the status change. The order row is locked first, so a second cancel
 * (or a cancel racing the expiry job) finds it cancelled — INVALID_STATUS_TRANSITION, never a
 * second restock. Paid orders need a refund (E10): ORDER_PAID.
 */
class CancelOrder
{
    public function __construct(
        private readonly StockLedger $stock,
        private readonly AuditTrail $audit,
    ) {}

    public function __invoke(Order $order, string $reason, ?string $actorId): Order
    {
        return DB::transaction(function () use ($order, $reason, $actorId) {
            /** @var Order $locked */
            $locked = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();

            return $this->cancelLocked($locked, $reason, $actorId);
        });
    }

    /**
     * Cancels an order the caller already locked inside its transaction.
     */
    public function cancelLocked(Order $locked, string $reason, ?string $actorId): Order
    {
        $from = $locked->status;
        $from->assertCanBecome(OrderStatus::Cancelled, $locked->number);
        if ($locked->payment_status === PaymentStatus::Paid) {
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
            'note' => mb_substr($reason, 0, 255),
            'actor_user_id' => $actorId,
            'created_at' => $now,
        ]);
        $this->audit->record('web_order.cancelled', $locked, ['status' => $from->value], [
            'status' => OrderStatus::Cancelled->value,
            'number' => $locked->number,
            'reason' => $reason,
        ]);

        return $locked;
    }
}
