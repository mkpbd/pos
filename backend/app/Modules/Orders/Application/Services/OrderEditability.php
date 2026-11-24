<?php

namespace App\Modules\Orders\Application\Services;

use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Domain\PaymentStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\Shipment;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * BD1b: whether staff may still change an order's contents — awaiting confirmation or payment,
 * confirmed or processing, unpaid, and not handed to a courier.
 */
final class OrderEditability
{
    public const EDITABLE = [OrderStatus::PendingConfirmation, OrderStatus::PendingPayment, OrderStatus::Confirmed, OrderStatus::Processing];

    /**
     * Why the order cannot be changed — `shipped` (handed to a courier, or later), `paid`
     * (any payment recorded) or `status` (cancelled, failed…) — or null when it can.
     */
    public static function blocker(Order $order): ?string
    {
        if (in_array($order->status, [OrderStatus::Shipped, OrderStatus::Delivered], true)
            || ($order->relationLoaded('shipment') ? $order->shipment !== null : Shipment::query()->where('order_id', $order->id)->exists())) {
            return 'shipped';
        }
        if ($order->payment_status !== PaymentStatus::Unpaid) {
            return 'paid';
        }

        return in_array($order->status, self::EDITABLE, true) ? null : 'status';
    }

    /**
     * @throws BusinessRuleViolation ORDER_NOT_EDITABLE (details.reason)
     */
    public static function assertEditable(Order $order): void
    {
        $reason = self::blocker($order);
        if ($reason !== null) {
            $message = match ($reason) {
                'shipped' => "{$order->number} has been shipped; it can no longer be changed.",
                'paid' => "{$order->number} is paid; it can no longer be changed.",
                default => "{$order->number} is {$order->status->label()}; it can no longer be changed.",
            };
            throw new BusinessRuleViolation('ORDER_NOT_EDITABLE', $message, ['reason' => $reason, 'status' => $order->status->value]);
        }
    }
}
