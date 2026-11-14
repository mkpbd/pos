<?php

namespace App\Modules\Orders\Infrastructure;

use App\Modules\Orders\Application\Contracts\OrderBaskets;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Domain\PaymentStatus;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;

/**
 * P1b: web orders as baskets of distinct products, read in pages of orders (keyset on the id)
 * with one query for each page's lines.
 */
class EloquentOrderBaskets implements OrderBaskets
{
    private const PAGE = 500;

    /** Orders that stand as sales (statuses after a confirmed placement). */
    private const COUNTED = [OrderStatus::Confirmed, OrderStatus::Processing, OrderStatus::Shipped, OrderStatus::Delivered];

    public function since(string $organizationId, DateTimeInterface $since): iterable
    {
        $lastId = null;
        do {
            $ids = DB::table('orders')
                ->where('organization_id', $organizationId)
                ->where('placed_at', '>=', $since)
                ->whereIn('status', array_map(fn (OrderStatus $s) => $s->value, self::COUNTED))
                ->where('payment_status', '!=', PaymentStatus::Refunded->value)
                ->when($lastId !== null, fn ($q) => $q->where('id', '>', $lastId))
                ->orderBy('id')
                ->limit(self::PAGE)
                ->pluck('id')->all();
            if ($ids === []) {
                return;
            }
            $lastId = (string) end($ids);

            $baskets = [];
            $rows = DB::table('order_lines')
                ->where('organization_id', $organizationId)
                ->whereIn('order_id', $ids)
                ->orderBy('order_id')->orderBy('position')
                ->get(['order_id', 'product_id']);
            foreach ($rows as $row) {
                $baskets[(string) $row->order_id][(string) $row->product_id] = true;
            }
            foreach ($baskets as $products) {
                if (count($products) >= 2) {
                    yield array_map('strval', array_keys($products));
                }
            }
        } while (count($ids) === self::PAGE);
    }
}
