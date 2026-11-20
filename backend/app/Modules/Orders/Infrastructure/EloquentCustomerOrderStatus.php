<?php

namespace App\Modules\Orders\Infrastructure;

use App\Modules\Orders\Application\Actions\CancelOwnOrder;
use App\Modules\Orders\Application\Contracts\CustomerOrderStatus;
use App\Modules\Orders\Application\Services\ReturnPolicy;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderLine;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shipping\Application\Contracts\CourierDirectory;

class EloquentCustomerOrderStatus implements CustomerOrderStatus
{
    private const MAX_ITEMS = 5;

    private const MAX_LINES = 10;

    public function __construct(
        private readonly ReturnPolicy $returnPolicy,
        private readonly CourierDirectory $couriers,
    ) {}

    public function recent(string $customerId, int $limit): array
    {
        return Order::query()->where('customer_id', $customerId)
            ->withSum('lines', 'quantity')->with('lines')
            ->orderByDesc('placed_at')->orderByDesc('id')
            ->limit(max(1, min(20, $limit)))->get()
            ->map(fn (Order $order) => $this->summary($order))->values()->all();
    }

    public function find(string $customerId, string $number): ?array
    {
        $number = trim($number);
        if ($number === '' || mb_strlen($number) > 40) {
            return null;
        }
        /** @var Order|null $order */
        $order = Order::query()->where('customer_id', $customerId)
            ->whereRaw('lower(number) = ?', [mb_strtolower($number)])
            ->withSum('lines', 'quantity')->with(['lines', 'shipment'])->first();
        if ($order === null) {
            return null;
        }

        $blocker = $this->returnPolicy->blocker($order);
        $returnable = $blocker === null && $this->returnPolicy->anythingLeft($order);
        $shipment = $order->shipment;

        return $this->summary($order) + [
            'payment_method' => $order->payment_method->label(),
            'lines' => $order->lines->sortBy('position')->take(self::MAX_LINES)->map(fn (OrderLine $l) => [
                'name' => $l->variant_name === null || $l->variant_name === '' ? $l->product_name : $l->product_name.' ('.$l->variant_name.')',
                'quantity' => self::quantity((string) $l->quantity),
            ])->values()->all(),
            'delivery_method' => $order->shipping_method_name,
            'eta_min_days' => $order->eta_min_days,
            'eta_max_days' => $order->eta_max_days,
            'shipment' => $shipment === null ? null : [
                'status' => $shipment->status->value,
                'status_label' => $shipment->status->label(),
                'courier' => $shipment->courier_name,
                'tracking_url' => $shipment->courier_id === null || $shipment->tracking_number === null ? null
                    : $this->couriers->trackingUrl($this->couriers->find($shipment->courier_id)['tracking_url_template'] ?? null, $shipment->tracking_number),
            ],
            'can_cancel' => CancelOwnOrder::allowed($order),
            'returnable' => $returnable,
            'return_deadline' => $this->returnPolicy->deadline($order)?->toIso8601String(),
        ];
    }

    /**
     * @return array{number: string, placed_at: string, status: string, status_label: string, payment_status: string, payment_status_label: string, total: string, currency: string, item_count: string, items: list<string>}
     */
    private function summary(Order $order): array
    {
        return [
            'number' => $order->number,
            'placed_at' => $order->placed_at->toIso8601String(),
            'status' => $order->status->value,
            'status_label' => $order->status->label(),
            'payment_status' => $order->payment_status->value,
            'payment_status_label' => $order->payment_status->label(),
            'total' => (string) $order->total,
            'currency' => $order->currency,
            'item_count' => self::quantity(Decimal::round((string) ($order->getAttribute('lines_sum_quantity') ?? '0'), 3)),
            'items' => $order->lines->sortBy('position')->pluck('product_name')->unique()->take(self::MAX_ITEMS)->map(fn ($n) => (string) $n)->values()->all(),
        ];
    }

    private static function quantity(string $quantity): string
    {
        return str_contains($quantity, '.') ? rtrim(rtrim($quantity, '0'), '.') : $quantity;
    }
}
