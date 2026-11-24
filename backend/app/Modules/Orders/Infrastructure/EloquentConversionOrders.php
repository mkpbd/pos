<?php

namespace App\Modules\Orders\Infrastructure;

use App\Modules\Marketing\Application\Contracts\ConversionOrders;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderLine;

/**
 * BD1c: a placed order as Marketing's Conversions API reports it (declared by Marketing).
 */
class EloquentConversionOrders implements ConversionOrders
{
    public function purchase(string $orderId): ?array
    {
        /** @var Order|null $order */
        $order = Order::query()->with(['lines', 'shippingAddress'])->find($orderId);
        if ($order === null) {
            return null;
        }
        $page = $order->attribution['order_page'] ?? null;

        return [
            'number' => $order->number,
            'source' => (string) $order->source,
            'page_path' => is_string($page) && str_starts_with($page, '/') ? $page : null,
            'placed_at' => $order->placed_at,
            'currency' => $order->currency,
            'total' => (string) $order->total,
            'contact_name' => $order->contact_name,
            'contact_email' => $order->contact_email,
            'contact_phone' => $order->contact_phone,
            'customer_id' => $order->customer_id,
            'district' => $order->shippingAddress?->district_name,
            'ip' => $order->ip,
            'user_agent' => $order->user_agent,
            'tracking_ids' => is_array($order->tracking_ids) ? $order->tracking_ids : null,
            'lines' => $order->lines->sortBy('position')->map(fn (OrderLine $line) => [
                'sku' => $line->sku,
                'variant_id' => $line->variant_id,
                'quantity' => (string) $line->quantity,
            ])->values()->all(),
        ];
    }
}
