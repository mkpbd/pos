<?php

namespace App\Modules\Orders\Application\Actions;

use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Domain\StockChange;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Orders\Application\Events\OrderCancelledWithRefund;
use App\Modules\Orders\Application\Services\RefundPayout;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Domain\PaymentStatus;
use App\Modules\Orders\Domain\RefundMethod;
use App\Modules\Orders\Domain\ShipmentStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderStatusChange;
use App\Modules\Orders\Infrastructure\Models\Shipment;
use App\Modules\Payments\Domain\PaymentSource;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Money;
use Illuminate\Support\Facades\DB;

/**
 * Cancels a web order that has not been delivered (staff, the customer — E9 — or the expiry
 * job with no actor): its stock goes back to the exact batches it left from, at the cost it
 * left with (`online_order_cancel`), in the same transaction as the status change. The order
 * row is locked first, so a second cancel (or a cancel racing the expiry job) finds it
 * cancelled — INVALID_STATUS_TRANSITION, never a second restock. A shipped order can be
 * cancelled only when its parcel was returned to the sender (E10a).
 *
 * Unpaid orders are cancelled with __invoke / cancelLocked (paid ones: ORDER_PAID). Paid
 * orders (E11) are cancelled by staff with cancelWithRefund(): everything paid and not yet
 * refunded goes back through the E10b refund path (RefundPayout) in the same transaction,
 * and the order becomes cancelled and `refunded`. Promotion redemptions are not reversed.
 */
class CancelOrder
{
    public function __construct(
        private readonly StockLedger $stock,
        private readonly AuditTrail $audit,
        private readonly RefundPayout $payout,
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
     * Cancels an unpaid order the caller already locked inside its transaction. `$actorType`
     * (customer | staff | system) defaults to staff with an actor, system without.
     *
     * @throws BusinessRuleViolation INVALID_STATUS_TRANSITION, ORDER_PAID
     */
    public function cancelLocked(Order $locked, ?string $reason, ?string $actorId, ?string $actorType = null): Order
    {
        $actorType ??= $actorId === null ? 'system' : 'staff';
        $from = $this->assertCancellable($locked);
        if ($locked->payment_status->isPaid()) {
            throw new BusinessRuleViolation('ORDER_PAID', "{$locked->number} is paid; cancel it with a refund instead.");
        }

        $this->restockAndClose($locked, $from, $reason, $actorId, $actorType, []);
        $this->audit->record('web_order.cancelled', $locked, ['status' => $from->value], [
            'status' => OrderStatus::Cancelled->value,
            'number' => $locked->number,
            'reason' => $reason,
            'by' => $actorType,
        ]);

        return $locked;
    }

    /**
     * Staff cancel a paid order that was not delivered (confirmed or processing, or shipped
     * with the parcel returned to the sender) and refund everything paid and not yet refunded
     * (`paid_total − refunded_total`) with `$method`. The customer is e-mailed afterwards.
     * An order that turns out to be unpaid is cancelled without a refund.
     *
     * @throws BusinessRuleViolation INVALID_STATUS_TRANSITION, CASH_SESSION_REQUIRED, INSUFFICIENT_CASH
     */
    public function cancelWithRefund(Order $order, string $reason, RefundMethod $method, ?string $reference, TenantUser $actor): Order
    {
        $actorId = (string) $actor->getAuthIdentifier();
        $refunded = false;

        $cancelled = DB::transaction(function () use ($order, $reason, $method, $reference, $actor, $actorId, &$refunded) {
            /** @var Order $locked */
            $locked = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
            if (! $locked->payment_status->isPaid()) {
                return $this->cancelLocked($locked, $reason, $actorId);
            }
            $from = $this->assertCancellable($locked);

            $paid = Money::of((string) $locked->paid_total, $locked->currency);
            $amount = $paid->minus(Money::of((string) $locked->refunded_total, $locked->currency));
            $paymentFrom = $locked->payment_status;
            $this->payout->payOut($locked, $amount, $method, $reference, $actor,
                new PaymentSource(PaymentSource::ONLINE_ORDER_REFUND, $locked->id, $locked->number),
                "Refund of cancelled web order {$locked->number}");

            $this->restockAndClose($locked, $from, $reason, $actorId, 'staff', [
                'payment_status' => PaymentStatus::Refunded,
                'refunded_total' => $paid->amount(),
            ]);
            $this->audit->record('web_order.cancelled', $locked, ['status' => $from->value, 'payment_status' => $paymentFrom->value], [
                'status' => OrderStatus::Cancelled->value,
                'payment_status' => PaymentStatus::Refunded->value,
                'number' => $locked->number,
                'reason' => $reason,
                'by' => 'staff',
                'refund' => ['amount' => $amount->amount(), 'method' => $method->value, 'reference' => $reference],
            ]);
            $this->audit->record('web_order.refunded', $locked, ['payment_status' => $paymentFrom->value, 'refunded_total' => $paid->minus($amount)->amount()], [
                'payment_status' => PaymentStatus::Refunded->value, 'refunded_total' => $paid->amount(), 'cancellation' => true, 'amount' => $amount->amount(), 'method' => $method->value,
            ]);
            $refunded = true;

            return $locked;
        });

        if ($refunded) {
            event(new OrderCancelledWithRefund($cancelled->organization_id, $cancelled->id, $method->value, $reference));
        }

        return $cancelled;
    }

    /**
     * Whether a paid order could be cancelled with a refund now (E11): paid, and confirmed or
     * processing, or shipped with its parcel returned to the sender.
     */
    public static function cancellableWithRefund(Order $order): bool
    {
        return $order->payment_status->isPaid()
            && ($order->status->canBecome(OrderStatus::Cancelled) || self::returnedToSender($order));
    }

    /**
     * A shipped order whose parcel came back to the sender (E10a): it may be cancelled — with
     * the same exact restock.
     */
    public static function returnedToSender(Order $order): bool
    {
        return $order->status === OrderStatus::Shipped
            && Shipment::query()->where('order_id', $order->id)->where('status', ShipmentStatus::Returned)->exists();
    }

    /**
     * @throws BusinessRuleViolation INVALID_STATUS_TRANSITION
     */
    private function assertCancellable(Order $locked): OrderStatus
    {
        $from = $locked->status;
        if (! self::returnedToSender($locked)) {
            $from->assertCanBecome(OrderStatus::Cancelled, $locked->number);
        }

        return $from;
    }

    /**
     * Stock back to the exact batches, order cancelled, status history appended.
     *
     * @param  array<string, mixed>  $extra  further order attributes
     */
    private function restockAndClose(Order $locked, OrderStatus $from, ?string $reason, ?string $actorId, string $actorType, array $extra): void
    {
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
        ] + $extra);
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
    }
}
