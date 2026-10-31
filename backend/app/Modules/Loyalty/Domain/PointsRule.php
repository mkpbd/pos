<?php

namespace App\Modules\Loyalty\Domain;

use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * Points arithmetic: whole points only, never in the customer's favour by rounding.
 */
final class PointsRule
{
    /**
     * Points earned on $basis: $pointsPerSpend for every full $spendAmount.
     */
    public static function earned(string $basis, string $spendAmount, int $pointsPerSpend): int
    {
        if (Decimal::compare($basis, '0') <= 0 || Decimal::compare($spendAmount, '0') <= 0) {
            return 0;
        }

        return (int) Decimal::round(self::floor(Decimal::div($basis, $spendAmount, 6)), 0) * $pointsPerSpend;
    }

    /**
     * Points needed to pay $amount, or null when $amount is not a whole number of points.
     */
    public static function forAmount(string $amount, string $pointValue): ?int
    {
        $points = Decimal::div($amount, $pointValue, 6);

        return Decimal::isWhole($points) ? (int) Decimal::round($points, 0) : null;
    }

    /**
     * $share (0–1) of $points, rounded down.
     */
    public static function share(int $points, string $share): int
    {
        return (int) Decimal::round(self::floor(Decimal::mul((string) $points, $share, 6)), 0);
    }

    private static function floor(string $value): string
    {
        $whole = Decimal::round($value, 0);

        return Decimal::compare($whole, $value) > 0 ? Decimal::sub($whole, '1', 0) : $whole;
    }
}
