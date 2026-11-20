<?php

namespace App\Modules\AI\Application\Tools\Shopper;

use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * AI2b: how the shopper tools write amounts and trim texts for the model — "BDT 450.00",
 * "BDT 450.00 – 600.00", plain text cut at a word boundary.
 */
final class ShopperText
{
    public static function money(?string $amount, string $currency): ?string
    {
        if ($amount === null || ! is_numeric($amount)) {
            return null;
        }

        return trim($currency.' '.Decimal::round($amount, 2));
    }

    /**
     * The price a shopper pays now on a product card or page: the automatic promotion's price
     * when one applies (same pricing path as the storefront), else the price or the range.
     *
     * @param  array<string, mixed>  $product  a catalog card or product page object
     */
    public static function price(array $product, string $currency): string
    {
        $promo = $product['promotion']['price'] ?? null;
        if (is_string($promo) && is_numeric($promo)) {
            return (string) self::money($promo, $currency);
        }
        $price = (string) ($product['price'] ?? '0');
        $max = $product['price_max'] ?? null;
        if (is_string($max) && is_numeric($max) && Decimal::compare($max, $price) > 0) {
            return $currency.' '.Decimal::round($price, 2).' – '.Decimal::round($max, 2);
        }

        return (string) self::money($price, $currency);
    }

    /**
     * The regular (crossed-out) price when the shopper pays less now, else null.
     *
     * @param  array<string, mixed>  $product
     */
    public static function regularPrice(array $product, string $currency): ?string
    {
        $promo = $product['promotion']['price'] ?? null;
        if (is_string($promo) && is_numeric($promo)) {
            return self::money((string) ($product['price'] ?? '0'), $currency);
        }
        $compare = $product['compare_at_price'] ?? null;
        if (($product['on_sale'] ?? false) && is_string($compare) && is_numeric($compare)) {
            return self::money($compare, $currency);
        }

        return null;
    }

    public static function clip(?string $text, int $max): ?string
    {
        if ($text === null) {
            return null;
        }
        $text = trim((string) preg_replace('/\s+/u', ' ', strip_tags($text)));
        if ($text === '') {
            return null;
        }
        if (mb_strlen($text) <= $max) {
            return $text;
        }
        $cut = mb_substr($text, 0, $max - 1);
        $space = mb_strrpos($cut, ' ');
        if ($space !== false && $space > $max / 2) {
            $cut = mb_substr($cut, 0, $space);
        }

        return rtrim($cut, ' ,.;:-').'…';
    }

    /**
     * "1–2" or "3" days.
     */
    public static function days(?int $min, ?int $max): ?string
    {
        if ($min === null && $max === null) {
            return null;
        }
        $min ??= $max;
        $max ??= $min;

        return $min === $max ? (string) $min : $min.'–'.$max;
    }
}
