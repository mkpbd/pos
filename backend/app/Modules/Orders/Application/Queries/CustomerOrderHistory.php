<?php

namespace App\Modules\Orders\Application\Queries;

use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\ModelNotFoundException;

/**
 * A signed-in customer's own web orders (E9): the orders placed while signed in to their
 * account (`orders.customer_id`). Guest orders placed with the same e-mail are not attached —
 * owning the e-mail address is not proven. Everything is inside the organization of the
 * storefront host (tenant scope), so another customer's or another store's order is 404.
 */
class CustomerOrderHistory
{
    public const PER_PAGE = 10;

    /** Status filter groups of the account order list. */
    public const GROUPS = [
        'open' => [OrderStatus::PendingPayment, OrderStatus::Confirmed, OrderStatus::Processing, OrderStatus::Shipped],
        'delivered' => [OrderStatus::Delivered],
        'cancelled' => [OrderStatus::Cancelled],
    ];

    /**
     * Newest first, with `lines_sum_quantity` and the lines (at most 50 per order) loaded.
     *
     * @return LengthAwarePaginator<int, Order>
     */
    public function page(string $customerId, ?string $group, int $page = 1): LengthAwarePaginator
    {
        return Order::query()
            ->where('customer_id', $customerId)
            ->when($group !== null, fn (Builder $q) => $q->whereIn('status', array_map(fn (OrderStatus $s) => $s->value, self::GROUPS[$group])))
            ->withSum('lines', 'quantity')
            ->with('lines')
            ->orderByDesc('placed_at')
            ->orderByDesc('id')
            ->paginate(self::PER_PAGE, ['*'], 'page', max(1, $page));
    }

    /**
     * @throws ModelNotFoundException unknown number or not the customer's order
     */
    public function find(string $customerId, string $number): Order
    {
        /** @var Order */
        return Order::query()->where('customer_id', $customerId)->where('number', $number)->firstOrFail();
    }
}
