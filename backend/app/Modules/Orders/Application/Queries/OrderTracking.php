<?php

namespace App\Modules\Orders\Application\Queries;

use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Shared\Domain\BangladeshMobile;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Database\Eloquent\Builder;

/**
 * BD1a: "track my order" without an account — the store's order with this number (any case)
 * whose contact or delivery mobile number is the given one. Anything else (unknown number,
 * another number's order, another store's order) is the same ORDER_NOT_FOUND.
 */
class OrderTracking
{
    /**
     * @throws BusinessRuleViolation ORDER_NOT_FOUND (404)
     */
    public function find(string $number, string $phone): Order
    {
        $number = trim($number);
        $phone = BangladeshMobile::normalize($phone);

        /** @var Order|null $order */
        $order = $phone === null || $number === '' ? null : Order::query()
            ->whereIn('number', array_values(array_unique([$number, mb_strtoupper($number)])))
            ->where(fn (Builder $q) => $q->where('contact_phone', $phone)
                ->orWhereHas('shippingAddress', fn (Builder $a) => $a->where('phone', $phone)))
            ->first();

        return $order ?? throw new BusinessRuleViolation('ORDER_NOT_FOUND', 'We could not find an order with this number and mobile number.', [], 404);
    }
}
