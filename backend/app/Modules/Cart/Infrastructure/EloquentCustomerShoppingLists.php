<?php

namespace App\Modules\Cart\Infrastructure;

use App\Modules\Cart\Infrastructure\Models\Cart;
use App\Modules\Cart\Infrastructure\Models\CartItem;
use App\Modules\Cart\Infrastructure\Models\Wishlist;
use App\Modules\Cart\Infrastructure\Models\WishlistItem;
use App\Modules\Customers\Application\Contracts\CustomerShoppingLists;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Carbon\CarbonImmutable;

/**
 * The customer's wishlist size and cart for the admin customer card (E10b).
 */
class EloquentCustomerShoppingLists implements CustomerShoppingLists
{
    public function summary(string $customerId): array
    {
        $wishlistId = Wishlist::query()->where('customer_id', $customerId)->value('id');
        $wishlistCount = $wishlistId === null ? 0 : WishlistItem::query()->where('wishlist_id', $wishlistId)->count();

        /** @var Cart|null $cart */
        $cart = Cart::query()->where('customer_id', $customerId)->whereNull('converted_order_id')->first();
        $summary = null;
        if ($cart !== null) {
            $items = CartItem::query()->where('cart_id', $cart->id)->get(['quantity', 'updated_at']);
            if ($items->isNotEmpty()) {
                $units = Decimal::round((string) $items->reduce(fn (string $sum, CartItem $i) => Decimal::add($sum, (string) $i->quantity, 3), '0'), 3);
                $times = array_filter([$cart->updated_at, ...$items->pluck('updated_at')->all()]);
                $latest = $times === [] ? null : max(array_map(fn ($t) => CarbonImmutable::parse($t), $times));
                $summary = [
                    'item_count' => str_contains($units, '.') ? rtrim(rtrim($units, '0'), '.') : $units,
                    'updated_at' => $latest?->toIso8601String(),
                ];
            }
        }

        return ['wishlist_count' => $wishlistCount, 'cart' => $summary];
    }
}
