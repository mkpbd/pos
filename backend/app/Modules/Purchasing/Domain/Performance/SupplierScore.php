<?php

namespace App\Modules\Purchasing\Domain\Performance;

use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * SC3: one 0–100 score per supplier from its delivery and quoting metrics.
 *
 * Components (each 0–100) and weights:
 *   on time          35  = on-time rate
 *   fill             30  = fill rate
 *   returns          15  = 100 − 5 × return rate (20 % returned → 0)
 *   price stability  10  = 100 − 5 × price increase % (decreases count as stable; +20 % → 0)
 *   responsiveness   10  = quote response rate
 * A metric without data (null) is left out and the remaining weights are scaled up to 100:
 * score = Σ weight × component ÷ Σ weight of the components present, rounded to a whole
 * number; no component at all → null.
 */
final class SupplierScore
{
    public const WEIGHTS = ['on_time' => 35, 'fill' => 30, 'returns' => 15, 'price_stability' => 10, 'responsiveness' => 10];

    /**
     * @return array{score: ?int, components: array<string, ?string>, weights: array<string, int>}
     */
    public static function compute(?string $onTimeRate, ?string $fillRate, ?string $returnRate, ?string $priceChangePct, ?string $responseRate): array
    {
        $components = [
            'on_time' => $onTimeRate === null ? null : self::clamp($onTimeRate),
            'fill' => $fillRate === null ? null : self::clamp($fillRate),
            'returns' => $returnRate === null ? null : self::clamp(Decimal::sub('100', Decimal::mul('5', $returnRate, 4), 4)),
            'price_stability' => $priceChangePct === null ? null : self::clamp(Decimal::sub('100', Decimal::mul('5', Decimal::max($priceChangePct, '0'), 4), 4)),
            'responsiveness' => $responseRate === null ? null : self::clamp($responseRate),
        ];

        $weighted = '0';
        $weights = [];
        foreach ($components as $key => $value) {
            if ($value === null) {
                continue;
            }
            $weights[$key] = self::WEIGHTS[$key];
            $weighted = Decimal::add($weighted, Decimal::mul((string) self::WEIGHTS[$key], $value, 4), 4);
        }
        $total = array_sum($weights);

        return [
            'score' => $total === 0 ? null : (int) Decimal::round(Decimal::div($weighted, (string) $total, 4), 0),
            'components' => $components,
            'weights' => $weights,
        ];
    }

    private static function clamp(string $value): string
    {
        return Decimal::round(Decimal::min(Decimal::max($value, '0'), '100'), 2);
    }
}
