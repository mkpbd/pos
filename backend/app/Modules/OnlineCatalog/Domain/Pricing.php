<?php

namespace App\Modules\OnlineCatalog\Domain;

use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * Storefront price rules. Prices are the variants' selling prices as stored (decimal
 * strings). A compare-at ("was") price only counts while it is above the selling price,
 * so a later price increase silently ends a sale instead of showing a negative discount.
 */
final class Pricing
{
    /**
     * The compare-at price when it is above the price, else null.
     */
    public static function effectiveCompareAt(string $price, ?string $compareAt): ?string
    {
        return $compareAt !== null && Decimal::compare($compareAt, $price) > 0 ? Decimal::round($compareAt, 2) : null;
    }

    /**
     * floor((compare_at − price) / compare_at × 100), or null when not on sale.
     */
    public static function discountPercent(string $price, ?string $compareAt): ?int
    {
        $compareAt = self::effectiveCompareAt($price, $compareAt);
        if ($compareAt === null) {
            return null;
        }

        // bcdiv truncates, which is floor for these positive amounts.
        return (int) bcdiv(bcmul(bcsub($compareAt, $price, 2), '100', 2), $compareAt, 0);
    }

    /**
     * Price range of a product's active variants and the sale shown on its card.
     *
     * @param  list<array{price: string, compare_at_price: ?string}>  $variants  non-empty
     * @return array{price: string, price_max: string, compare_at_price: ?string, on_sale: bool, discount_percent: ?int}
     */
    public static function summary(array $variants): array
    {
        $min = null;
        $max = null;
        $compareAt = null;
        $onSale = false;

        foreach ($variants as $variant) {
            $effective = self::effectiveCompareAt($variant['price'], $variant['compare_at_price']);
            $onSale = $onSale || $effective !== null;

            $cmp = $min === null ? -1 : Decimal::compare($variant['price'], $min);
            if ($cmp < 0) {
                $min = $variant['price'];
                $compareAt = $effective;
            } elseif ($cmp === 0 && $compareAt === null && $effective !== null) {
                // Among equally cheap variants, the one on sale explains the card's price.
                $compareAt = $effective;
            }
            if ($max === null || Decimal::compare($variant['price'], $max) > 0) {
                $max = $variant['price'];
            }
        }

        return [
            'price' => Decimal::round((string) $min, 2),
            'price_max' => Decimal::round((string) $max, 2),
            'compare_at_price' => $compareAt,
            'on_sale' => $onSale,
            'discount_percent' => $compareAt === null ? null : self::discountPercent((string) $min, $compareAt),
        ];
    }
}
