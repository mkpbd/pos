<?php

namespace App\Modules\Orders\Infrastructure;

use App\Modules\Orders\Application\Contracts\PurchaseVerifier;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Infrastructure\Models\OrderLine;

final class EloquentPurchaseVerifier implements PurchaseVerifier
{
    public function deliveredLine(string $customerId, string $productId): ?string
    {
        // The organization scope of OrderLine keeps it inside the tenant; the order must be the customer's and delivered.
        $id = OrderLine::query()
            ->join('orders', 'orders.id', '=', 'order_lines.order_id')
            ->where('order_lines.product_id', $productId)
            ->where('orders.customer_id', $customerId)
            ->where('orders.status', OrderStatus::Delivered->value)
            ->whereColumn('orders.organization_id', 'order_lines.organization_id')
            ->orderByDesc('orders.delivered_at')
            ->orderByDesc('order_lines.id')
            ->value('order_lines.id');

        return $id === null ? null : (string) $id;
    }
}
