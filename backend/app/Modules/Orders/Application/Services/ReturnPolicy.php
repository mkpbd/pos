<?php

namespace App\Modules\Orders\Application\Services;

use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Domain\ReturnStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderReturn;
use App\Modules\Orders\Infrastructure\Models\OrderReturnLine;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Carbon\CarbonImmutable;

/**
 * Whether goods of a web order can be returned (E10b), and how much of each line.
 *
 * - Only `delivered` orders whose money was received (`paid`, `partially_refunded`; a fully
 *   `refunded` order has nothing left to return anyway).
 * - Within `return_window_days` (storefront settings, default 7; 0 = no online returns) of
 *   `delivered_at`; staff may override the window (and a disabled window) with a note.
 * - A line can be returned up to its ordered quantity minus what active returns (requested,
 *   approved, received, refunded) already hold.
 */
class ReturnPolicy
{
    public const NOT_DELIVERED = 'not_delivered';

    public const NOT_PAID = 'not_paid';

    public const RETURNS_DISABLED = 'returns_disabled';

    public const WINDOW_CLOSED = 'window_closed';

    public function __construct(private readonly StorefrontConfig $storefront) {}

    public function windowDays(): int
    {
        return (int) $this->storefront->settings()->return_window_days;
    }

    /**
     * The last moment the customer may ask for a return; null when not delivered or returns are off.
     */
    public function deadline(Order $order): ?CarbonImmutable
    {
        if ($order->status !== OrderStatus::Delivered || $order->delivered_at === null || $this->windowDays() === 0) {
            return null;
        }

        return $order->delivered_at->addDays($this->windowDays());
    }

    /**
     * Why the order cannot be returned now (null = it can). With `$ignoreWindow` (staff
     * override) only delivery and payment count.
     */
    public function blocker(Order $order, bool $ignoreWindow = false): ?string
    {
        if ($order->status !== OrderStatus::Delivered) {
            return self::NOT_DELIVERED;
        }
        if (! $order->payment_status->isPaid()) {
            return self::NOT_PAID;
        }
        if ($ignoreWindow) {
            return null;
        }
        if ($this->windowDays() === 0) {
            return self::RETURNS_DISABLED;
        }
        $deadline = $this->deadline($order);

        return $deadline !== null && CarbonImmutable::now()->greaterThan($deadline) ? self::WINDOW_CLOSED : null;
    }

    /**
     * Quantity still returnable per order line id (ordered − held by active returns), for
     * every line of the order. `$exceptReturnId` leaves one return out (re-valuing it).
     *
     * @return array<string, string>
     */
    public function returnable(Order $order, ?string $exceptReturnId = null): array
    {
        $held = $this->held($order, $exceptReturnId);
        $result = [];
        foreach ($order->lines as $line) {
            $left = Decimal::sub((string) $line->quantity, $held[$line->id]['quantity'] ?? '0', 3);
            $result[$line->id] = Decimal::compare($left, '0') > 0 ? $left : '0.000';
        }

        return $result;
    }

    /**
     * What active returns of the order (all but `$exceptReturnId`) hold per order line:
     * quantity, amount, tax and cost — the "already returned" side of the remainder rule.
     *
     * @return array<string, array{quantity: string, line_total: string, tax_amount: string, cost_total: string}>
     */
    public function held(Order $order, ?string $exceptReturnId = null): array
    {
        $returnIds = OrderReturn::query()->where('order_id', $order->id)
            ->whereIn('status', ReturnStatus::activeValues())
            ->when($exceptReturnId !== null, fn ($q) => $q->whereKeyNot($exceptReturnId))
            ->pluck('id');

        $held = [];
        foreach (OrderReturnLine::query()->whereIn('return_id', $returnIds)->get() as $line) {
            $sum = $held[$line->order_line_id] ?? ['quantity' => '0', 'line_total' => '0', 'tax_amount' => '0', 'cost_total' => '0'];
            $held[$line->order_line_id] = [
                'quantity' => Decimal::add($sum['quantity'], (string) $line->quantity, 3),
                'line_total' => Decimal::add($sum['line_total'], (string) $line->amount, 2),
                'tax_amount' => Decimal::add($sum['tax_amount'], (string) $line->tax_amount, 2),
                'cost_total' => Decimal::add($sum['cost_total'], (string) $line->cost_total, 2),
            ];
        }

        return $held;
    }

    /**
     * Whether anything of the order is left to return.
     */
    public function anythingLeft(Order $order): bool
    {
        foreach ($this->returnable($order) as $quantity) {
            if (Decimal::compare($quantity, '0') > 0) {
                return true;
            }
        }

        return false;
    }

    /**
     * The shipping refund other active returns of the order already granted.
     */
    public function shippingRefunded(Order $order, ?string $exceptReturnId = null): string
    {
        $sum = OrderReturn::query()->where('order_id', $order->id)
            ->whereIn('status', ReturnStatus::activeValues())
            ->when($exceptReturnId !== null, fn ($q) => $q->whereKeyNot($exceptReturnId))
            ->sum('shipping_refund');

        return Decimal::round((string) $sum, 2);
    }
}
