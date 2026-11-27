<?php

namespace App\Modules\Shipping\Domain;

use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * BD2a: the weight a delivery is priced for — Σ variant `weight_grams` × quantity of the
 * priced lines, rounded up to whole grams; a variant without a weight counts 0.
 */
final class ParcelWeight
{
    /**
     * @param  list<array{variant_id: string, quantity: string}>  $lines
     * @param  array<string, array<string, mixed>>  $variants  by id, with `weight_grams` (?int)
     */
    public static function grams(array $lines, array $variants): int
    {
        $grams = '0';
        foreach ($lines as $line) {
            $weight = $variants[$line['variant_id']]['weight_grams'] ?? null;
            if ($weight !== null) {
                $grams = Decimal::add($grams, Decimal::mul((string) $weight, (string) $line['quantity'], 3), 3);
            }
        }

        return (int) Decimal::ceil($grams);
    }
}
