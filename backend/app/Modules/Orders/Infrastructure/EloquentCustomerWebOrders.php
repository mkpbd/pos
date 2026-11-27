<?php

namespace App\Modules\Orders\Infrastructure;

use App\Modules\Customers\Application\Contracts\CustomerWebOrders;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Domain\ReturnStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderReturn;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;

/**
 * The customer's web orders and returns for the admin customer card (E10b).
 */
class EloquentCustomerWebOrders implements CustomerWebOrders
{
    public function summary(string $customerId): array
    {
        $orders = Order::query()->where('customer_id', $customerId);
        $count = (clone $orders)->whereNotIn('status', [OrderStatus::Cancelled->value, OrderStatus::Failed->value])->count();
        $paid = (string) ((clone $orders)->sum('paid_total') ?? '0');
        $refunded = (string) ((clone $orders)->sum('refunded_total') ?? '0');
        $spent = Decimal::sub(Decimal::round($paid, 2), Decimal::round($refunded, 2), 2);
        $paidOrders = (clone $orders)->where('paid_total', '>', 0)->count();
        /** @var Order|null $last */
        $last = (clone $orders)->orderByDesc('placed_at')->first(['placed_at']);

        $recent = (clone $orders)->orderByDesc('placed_at')->orderByDesc('id')->limit(5)->get()->map(fn (Order $o) => [
            'id' => $o->id,
            'number' => $o->number,
            'placed_at' => $o->placed_at->toIso8601String(),
            'status' => $o->status->value,
            'status_label' => $o->status->label(),
            'payment_status' => $o->payment_status->value,
            'total' => (string) $o->total,
            'currency' => $o->currency,
        ])->values()->all();

        return [
            'orders' => [
                'count' => $count,
                'total_spent' => $spent,
                'last_order_at' => $last?->placed_at->toIso8601String(),
                'average_order' => $paidOrders === 0 ? '0.00' : Decimal::div($spent, (string) $paidOrders, 2),
            ],
            'returns_count' => OrderReturn::query()->where('status', '!=', ReturnStatus::Cancelled->value)
                ->whereHas('order', fn (Builder $q) => $q->where('customer_id', $customerId))->count(),
            'recent_orders' => $recent,
        ];
    }

    public function orderedWithin(array $windows): array
    {
        if ($windows === []) {
            return [];
        }
        $earliest = min(array_map(fn (array $w) => CarbonImmutable::instance($w['from']), $windows));
        $placed = Order::query()
            ->whereIn('customer_id', array_values(array_unique(array_column($windows, 'customer_id'))))
            ->where('status', '!=', OrderStatus::Failed->value)
            ->where('placed_at', '>=', $earliest->utc())
            ->get(['customer_id', 'placed_at'])
            ->groupBy('customer_id');

        $keys = [];
        foreach ($windows as $key => $w) {
            $hit = ($placed[$w['customer_id']] ?? collect())->contains(fn (Order $o) => $o->placed_at->greaterThanOrEqualTo($w['from'])
                && ($w['to'] === null || $o->placed_at->lessThan($w['to'])));
            if ($hit) {
                $keys[] = (string) $key;
            }
        }

        return $keys;
    }
}
