<?php

namespace App\Modules\AI\Application\Support;

use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * Small exact-decimal helpers for insight facts (no floats).
 */
final class Figures
{
    /**
     * A figure with its previous-period value: change and change % (null when previous is 0).
     *
     * @return array{value: string|int, previous: string|int, change: string|int, change_pct: ?string}
     */
    public static function compare(string|int $value, string|int $previous, int $scale = 2): array
    {
        if (is_int($value) && is_int($previous)) {
            return [
                'value' => $value,
                'previous' => $previous,
                'change' => $value - $previous,
                'change_pct' => $previous === 0 ? null : self::percent((string) ($value - $previous), (string) abs($previous)),
            ];
        }
        $value = self::plain($value);
        $previous = self::plain($previous);
        $change = Decimal::sub($value, $previous, $scale);

        return [
            'value' => Decimal::round($value, $scale),
            'previous' => Decimal::round($previous, $scale),
            'change' => $change,
            'change_pct' => Decimal::isZero($previous) ? null : self::percent($change, ltrim($previous, '-')),
        ];
    }

    /** part ÷ whole × 100, 2 decimals; null when whole is 0. */
    public static function percent(string $part, string $whole): ?string
    {
        $whole = self::plain($whole);
        if (Decimal::isZero($whole)) {
            return null;
        }

        return Decimal::round(Decimal::div(Decimal::mul(self::plain($part), '100', 8), $whole, 8), 2);
    }

    public static function plain(mixed $value): string
    {
        $value = trim((string) ($value ?? '0'));

        return $value === '' ? '0' : $value;
    }
}
