<?php

namespace App\Modules\Cart\Domain;

use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * Limits and quantity arithmetic of carts and wishlists.
 */
final class CartRules
{
    public const MAX_LINES = 50;

    public const MAX_QUANTITY = '999';

    public const GUEST_TTL_DAYS = 30;

    public const MAX_WISHLIST_ITEMS = 200;

    public const MAX_WISHLIST_MERGE = 100;

    /**
     * A quantity as shown to shoppers: trailing decimal zeros dropped ("2", "1.5").
     */
    public static function display(string $quantity): string
    {
        $value = Decimal::round($quantity, 3);

        return str_contains($value, '.') ? rtrim(rtrim($value, '0'), '.') : $value;
    }

    /**
     * The quantity a line counts with: never more than what can be supplied.
     */
    public static function countable(string $quantity, ?string $maxQuantity): string
    {
        return $maxQuantity !== null && Decimal::compare($quantity, $maxQuantity) > 0 ? $maxQuantity : $quantity;
    }

    /**
     * Merged quantity of a guest line into a customer line: summed, capped at what can be
     * supplied (when something can) and at MAX_QUANTITY.
     *
     * @return array{0: string, 1: bool} the quantity and whether it was capped
     */
    public static function merged(string $existing, string $added, ?string $maxQuantity): array
    {
        $sum = Decimal::add($existing, $added, 3);
        $cap = self::MAX_QUANTITY;
        if ($maxQuantity !== null && Decimal::compare($maxQuantity, '0') > 0 && Decimal::compare($maxQuantity, $cap) < 0) {
            $cap = $maxQuantity;
        }
        if (Decimal::compare($sum, $cap) > 0) {
            // Never below what the customer already had.
            return [Decimal::compare($existing, $cap) > 0 ? Decimal::round($existing, 3) : Decimal::round($cap, 3), true];
        }

        return [$sum, false];
    }
}
