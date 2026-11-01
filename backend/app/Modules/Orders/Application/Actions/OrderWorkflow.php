<?php

namespace App\Modules\Orders\Application\Actions;

use App\Modules\Orders\Domain\OrderPaymentMethod;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Domain\PaymentStatus;
use App\Modules\Orders\Domain\ShipmentStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderStatusChange;
use App\Modules\Orders\Infrastructure\Models\Shipment;
use App\Modules\Orders\Infrastructure\Models\ShipmentEvent;
use App\Modules\Payments\Application\Contracts\PaymentLedger;
use App\Modules\Payments\Domain\LedgerEntry;
use App\Modules\Payments\Domain\PaymentDirection;
use App\Modules\Payments\Domain\PaymentMethod as LedgerMethod;
use App\Modules\Payments\Domain\PaymentSource;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shipping\Application\Contracts\CourierDirectory;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Staff steps of a web order. Every step locks the order row, checks the transition
 * (INVALID_STATUS_TRANSITION), appends the status history and is audited (`web_order.*`).
 *
 * Money (ADR-006): confirming a bank transfer records `bank_transfer` and recording the
 * courier's cash-on-delivery remittance records `cash_on_delivery`, both for the order total
 * through PaymentLedger::recordSystem (no drawer). A second payment is ORDER_ALREADY_PAID.
 * COD remittances (E10a) share recordCodPaymentLocked().
 *
 * Shipping (E10a) creates the order's shipment with a courier; courier updates
 * (shipmentEvent) append shipment events, `delivered` delivers the order.
 */
class OrderWorkflow
{
    public function __construct(
        private readonly PaymentLedger $payments,
        private readonly AuditTrail $audit,
        private readonly CourierDirectory $couriers,
    ) {}

    /**
     * Bank transfer received: pending_payment → confirmed, paid.
     */
    public function confirmPayment(Order $order, string $reference, string $actorId): Order
    {
        return $this->locked($order, function (Order $o) use ($reference, $actorId) {
            $this->assertUnpaid($o);
            if ($o->payment_method !== OrderPaymentMethod::BankTransfer) {
                throw new BusinessRuleViolation('INVALID_STATUS_TRANSITION', "{$o->number} is not paid by bank transfer.", ['payment_method' => $o->payment_method->value]);
            }
            $from = $o->status;
            $from->assertCanBecome(OrderStatus::Confirmed, $o->number);

            $this->recordPayment($o, LedgerMethod::BankTransfer, $reference, $actorId);
            $o->update([
                'status' => OrderStatus::Confirmed,
                'payment_status' => PaymentStatus::Paid,
                'paid_total' => $o->total,
                'confirmed_at' => now(),
                'expires_at' => null,
            ]);
            $this->history($o, $from, OrderStatus::Confirmed, "Payment confirmed ({$reference})", $actorId);
            $this->audit->record('web_order.payment_confirmed', $o, ['status' => $from->value, 'payment_status' => PaymentStatus::Unpaid->value], [
                'status' => OrderStatus::Confirmed->value, 'payment_status' => PaymentStatus::Paid->value, 'amount' => $o->total, 'reference' => $reference,
            ]);
        });
    }

    public function process(Order $order, string $actorId): Order
    {
        return $this->locked($order, fn (Order $o) => $this->move($o, OrderStatus::Processing, [], null, $actorId, 'web_order.processing'));
    }

    /**
     * processing → shipped (E10a): the parcel goes to an active courier — a shipment with the
     * amount the courier collects (the total of an unpaid COD order, else 0) and its first
     * event `handed_over`. The order keeps the courier name and tracking number too.
     *
     * @throws ValidationException courier_id (unknown or inactive courier)
     */
    public function ship(Order $order, string $courierId, ?string $trackingNumber, ?string $note, string $actorId): Order
    {
        $courier = $this->couriers->find($courierId);
        if ($courier === null || ! $courier['is_active']) {
            throw ValidationException::withMessages(['courier_id' => ['The selected courier is not an active courier.']]);
        }

        return $this->locked($order, function (Order $o) use ($courier, $trackingNumber, $note, $actorId) {
            $now = CarbonImmutable::now();
            $this->move($o, OrderStatus::Shipped, [
                'courier_name' => $courier['name'],
                'tracking_number' => $trackingNumber,
                'shipped_at' => $now,
            ], trim($courier['name'].' '.($trackingNumber ?? '')), $actorId, 'web_order.shipped');

            $cod = $o->payment_method === OrderPaymentMethod::CashOnDelivery && $o->payment_status === PaymentStatus::Unpaid;
            $shipment = Shipment::query()->create([
                'organization_id' => $o->organization_id,
                'order_id' => $o->id,
                'courier_id' => $courier['id'],
                'courier_name' => $courier['name'],
                'tracking_number' => $trackingNumber,
                'status' => ShipmentStatus::HandedOver,
                'cod_amount' => $cod ? (string) $o->total : '0.00',
                'shipped_at' => $now,
                'created_by' => $actorId,
            ]);
            $this->event($shipment, ShipmentStatus::HandedOver, $note, $now, $actorId);
        });
    }

    /**
     * shipped → delivered. With a shipment (E10a) the parcel becomes delivered too and gets a
     * `delivered` event; a parcel returned to the sender cannot be delivered.
     */
    public function deliver(Order $order, string $actorId): Order
    {
        return $this->locked($order, fn (Order $o) => $this->deliverLocked($o, null, null, $actorId));
    }

    /**
     * A courier update on the order's shipment (E10a): `in_transit`, `delivered` (the order is
     * delivered, as with deliver()) or `returned` (refused / undeliverable: the parcel comes back;
     * the unpaid order may then be cancelled with restock). Orders shipped before E10a have no
     * shipment: SHIPMENT_NOT_FOUND.
     */
    public function shipmentEvent(Order $order, ShipmentStatus $status, ?string $note, ?CarbonImmutable $occurredAt, string $actorId): Order
    {
        return $this->locked($order, function (Order $o) use ($status, $note, $occurredAt, $actorId) {
            $shipment = $this->lockedShipment($o);
            $at = $occurredAt ?? CarbonImmutable::now();
            if ($at->lessThan($shipment->shipped_at)) {
                throw ValidationException::withMessages(['occurred_at' => ['The update cannot be earlier than the hand-over to the courier.']]);
            }

            if ($status === ShipmentStatus::Delivered) {
                if ($o->status !== OrderStatus::Shipped) {
                    $shipment->status->assertCanBecome($status, $o->number);
                }
                $this->deliverLocked($o, $note, $at, $actorId);

                return;
            }
            $from = $shipment->status;
            $from->assertCanBecome($status, $o->number);
            if ($o->status !== OrderStatus::Shipped) {
                throw new BusinessRuleViolation('INVALID_STATUS_TRANSITION', "{$o->number} is {$o->status->label()}; its parcel cannot change any more.", [
                    'from' => $from->value, 'to' => $status->value, 'allowed' => [],
                ]);
            }
            $shipment->update(['status' => $status] + ($status === ShipmentStatus::Returned ? ['returned_at' => $at] : []));
            $this->event($shipment, $status, $note, $at, $actorId);
            $this->audit->record($status === ShipmentStatus::Returned ? 'web_order.shipment_returned' : 'web_order.shipment_updated', $o, ['shipment_status' => $from->value], [
                'shipment_status' => $status->value, 'number' => $o->number, 'note' => $note, 'occurred_at' => $at->format(DATE_ATOM),
            ]);
        });
    }

    /**
     * The courier's cash-on-delivery remittance arrived: only COD orders that are shipped or delivered.
     */
    public function recordCodPayment(Order $order, ?string $reference, string $actorId): Order
    {
        return $this->locked($order, fn (Order $o) => $this->recordCodPaymentLocked($o, $reference, $actorId));
    }

    /**
     * The cash-on-delivery payment of an order the caller already locked inside its
     * transaction: the single path shared by "Record COD payment" and courier COD
     * remittances (E10a) — `cash_on_delivery` in the ledger for the order total, order paid.
     */
    public function recordCodPaymentLocked(Order $o, ?string $reference, string $actorId): void
    {
        $this->assertUnpaid($o);
        if ($o->payment_method !== OrderPaymentMethod::CashOnDelivery || ! in_array($o->status, [OrderStatus::Shipped, OrderStatus::Delivered], true)) {
            throw new BusinessRuleViolation('INVALID_STATUS_TRANSITION', "A cash-on-delivery payment can only be recorded for a shipped or delivered cash-on-delivery order; {$o->number} is {$o->status->label()}.", [
                'status' => $o->status->value,
                'payment_method' => $o->payment_method->value,
            ]);
        }
        // A parcel returned to the sender collected no cash: it is cancelled and restocked instead.
        if (Shipment::query()->where('order_id', $o->id)->where('status', ShipmentStatus::Returned)->exists()) {
            throw new BusinessRuleViolation('INVALID_STATUS_TRANSITION', "{$o->number} came back to the sender, so no cash on delivery was collected; cancel it to restock instead.", [
                'status' => $o->status->value,
                'shipment_status' => ShipmentStatus::Returned->value,
            ]);
        }

        $this->recordPayment($o, LedgerMethod::CashOnDelivery, $reference, $actorId);
        $o->update(['payment_status' => PaymentStatus::Paid, 'paid_total' => $o->total]);
        $this->audit->record('web_order.cod_payment_recorded', $o, ['payment_status' => PaymentStatus::Unpaid->value], [
            'payment_status' => PaymentStatus::Paid->value, 'amount' => $o->total, 'reference' => $reference,
        ]);
    }

    private function deliverLocked(Order $o, ?string $note, ?CarbonImmutable $at, string $actorId): void
    {
        $at ??= CarbonImmutable::now();
        $shipment = Shipment::query()->where('order_id', $o->id)->lockForUpdate()->first();
        if ($shipment !== null && $o->status === OrderStatus::Shipped) {
            $shipment->status->assertCanBecome(ShipmentStatus::Delivered, $o->number);
        }
        $this->move($o, OrderStatus::Delivered, ['delivered_at' => $at], $note, $actorId, 'web_order.delivered');
        if ($shipment !== null) {
            $shipment->update(['status' => ShipmentStatus::Delivered, 'delivered_at' => $at]);
            $this->event($shipment, ShipmentStatus::Delivered, $note, $at, $actorId);
        }
    }

    /**
     * @throws BusinessRuleViolation SHIPMENT_NOT_FOUND
     */
    private function lockedShipment(Order $o): Shipment
    {
        return Shipment::query()->where('order_id', $o->id)->lockForUpdate()->first()
            ?? throw new BusinessRuleViolation('SHIPMENT_NOT_FOUND', "{$o->number} has no courier shipment to update.", ['status' => $o->status->value]);
    }

    private function event(Shipment $shipment, ShipmentStatus $status, ?string $note, CarbonInterface $at, ?string $actorId): void
    {
        ShipmentEvent::query()->create([
            'organization_id' => $shipment->organization_id,
            'shipment_id' => $shipment->id,
            'status' => $status,
            'note' => $note === null || $note === '' ? null : mb_substr($note, 0, 200),
            'occurred_at' => $at,
            'created_by' => $actorId,
            'created_at' => now(),
        ]);
    }

    /**
     * @param  Closure(Order): mixed  $step
     */
    private function locked(Order $order, Closure $step): Order
    {
        return DB::transaction(function () use ($order, $step) {
            /** @var Order $locked */
            $locked = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
            $step($locked);

            return $locked;
        });
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function move(Order $o, OrderStatus $to, array $attributes, ?string $note, string $actorId, string $action): void
    {
        $from = $o->status;
        $from->assertCanBecome($to, $o->number);
        $o->update(['status' => $to] + $attributes);
        $this->history($o, $from, $to, $note === '' ? null : $note, $actorId);
        $this->audit->record($action, $o, ['status' => $from->value], ['status' => $to->value, 'number' => $o->number] + array_map(
            fn ($v) => $v instanceof \DateTimeInterface ? $v->format(DATE_ATOM) : $v,
            $attributes,
        ));
    }

    private function assertUnpaid(Order $o): void
    {
        if ($o->payment_status === PaymentStatus::Paid) {
            throw new BusinessRuleViolation('ORDER_ALREADY_PAID', "{$o->number} is already paid.");
        }
    }

    private function recordPayment(Order $o, LedgerMethod $method, ?string $reference, string $actorId): void
    {
        $this->payments->recordSystem($o->branch_id, [
            new LedgerEntry(PaymentDirection::In, $method, (string) $o->total, $o->customer_id, $reference, "Web order {$o->number}"),
        ], new PaymentSource(PaymentSource::ONLINE_ORDER, $o->id, $o->number), $actorId);
    }

    private function history(Order $o, OrderStatus $from, OrderStatus $to, ?string $note, string $actorId): void
    {
        OrderStatusChange::query()->create([
            'organization_id' => $o->organization_id,
            'order_id' => $o->id,
            'from_status' => $from,
            'to_status' => $to,
            'note' => $note === null ? null : mb_substr($note, 0, 255),
            'actor_user_id' => $actorId,
            'actor_type' => 'staff',
            'created_at' => now(),
        ]);
    }
}
