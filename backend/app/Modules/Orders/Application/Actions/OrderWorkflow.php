<?php

namespace App\Modules\Orders\Application\Actions;

use App\Modules\Orders\Domain\OrderPaymentMethod;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Domain\PaymentStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderStatusChange;
use App\Modules\Payments\Application\Contracts\PaymentLedger;
use App\Modules\Payments\Domain\LedgerEntry;
use App\Modules\Payments\Domain\PaymentDirection;
use App\Modules\Payments\Domain\PaymentMethod as LedgerMethod;
use App\Modules\Payments\Domain\PaymentSource;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Closure;
use Illuminate\Support\Facades\DB;

/**
 * Staff steps of a web order. Every step locks the order row, checks the transition
 * (INVALID_STATUS_TRANSITION), appends the status history and is audited (`web_order.*`).
 *
 * Money (ADR-006): confirming a bank transfer records `bank_transfer` and recording the
 * courier's cash-on-delivery remittance records `cash_on_delivery`, both for the order total
 * through PaymentLedger::recordSystem (no drawer). A second payment is ORDER_ALREADY_PAID.
 */
class OrderWorkflow
{
    public function __construct(
        private readonly PaymentLedger $payments,
        private readonly AuditTrail $audit,
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

    public function ship(Order $order, string $courierName, ?string $trackingNumber, string $actorId): Order
    {
        return $this->locked($order, fn (Order $o) => $this->move($o, OrderStatus::Shipped, [
            'courier_name' => $courierName,
            'tracking_number' => $trackingNumber,
            'shipped_at' => now(),
        ], trim($courierName.' '.($trackingNumber ?? '')), $actorId, 'web_order.shipped'));
    }

    public function deliver(Order $order, string $actorId): Order
    {
        return $this->locked($order, fn (Order $o) => $this->move($o, OrderStatus::Delivered, ['delivered_at' => now()], null, $actorId, 'web_order.delivered'));
    }

    /**
     * The courier's cash-on-delivery remittance arrived: only COD orders that are shipped or delivered.
     */
    public function recordCodPayment(Order $order, ?string $reference, string $actorId): Order
    {
        return $this->locked($order, function (Order $o) use ($reference, $actorId) {
            $this->assertUnpaid($o);
            if ($o->payment_method !== OrderPaymentMethod::CashOnDelivery || ! in_array($o->status, [OrderStatus::Shipped, OrderStatus::Delivered], true)) {
                throw new BusinessRuleViolation('INVALID_STATUS_TRANSITION', "A cash-on-delivery payment can only be recorded for a shipped or delivered cash-on-delivery order; {$o->number} is {$o->status->label()}.", [
                    'status' => $o->status->value,
                    'payment_method' => $o->payment_method->value,
                ]);
            }

            $this->recordPayment($o, LedgerMethod::CashOnDelivery, $reference, $actorId);
            $o->update(['payment_status' => PaymentStatus::Paid, 'paid_total' => $o->total]);
            $this->audit->record('web_order.cod_payment_recorded', $o, ['payment_status' => PaymentStatus::Unpaid->value], [
                'payment_status' => PaymentStatus::Paid->value, 'amount' => $o->total, 'reference' => $reference,
            ]);
        });
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
