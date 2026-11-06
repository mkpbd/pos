<?php

namespace App\Modules\Shared\Domain\ValueObjects;

use BCMath\Number;
use InvalidArgumentException;
use RoundingMode;

/**
 * Exact decimal arithmetic for quantities, unit costs and rates (strings in, strings out).
 * Money amounts use Money; this covers the other NUMERIC columns.
 */
final class Decimal
{
    private const ROUNDING = RoundingMode::HalfAwayFromZero;

    public static function add(string $a, string $b, int $scale): string
    {
        return self::fix(self::n($a)->add(self::n($b)), $scale);
    }

    public static function sub(string $a, string $b, int $scale): string
    {
        return self::fix(self::n($a)->sub(self::n($b)), $scale);
    }

    public static function mul(string $a, string $b, int $scale): string
    {
        return self::fix(self::n($a)->mul(self::n($b)), $scale);
    }

    public static function div(string $a, string $b, int $scale): string
    {
        if (self::n($b)->compare(0) === 0) {
            throw new InvalidArgumentException('Division by zero.');
        }

        return self::fix(self::n($a)->div(self::n($b), $scale + 6), $scale);
    }

    public static function compare(string $a, string $b): int
    {
        return self::n($a)->compare(self::n($b));
    }

    public static function isZero(string $a): bool
    {
        return self::n($a)->compare(0) === 0;
    }

    public static function isNegative(string $a): bool
    {
        return self::n($a)->compare(0) < 0;
    }

    public static function negate(string $a, int $scale): string
    {
        return self::fix(self::n($a)->mul(-1), $scale);
    }

    /**
     * Whether the value has no fractional part (for units that disallow decimals).
     */
    public static function isWhole(string $a): bool
    {
        $n = self::n($a);

        return $n->compare($n->floor()) === 0;
    }

    /**
     * Smallest value with `$scale` decimals that is not below `$a` (2.0001 -> 3 at scale 0).
     */
    public static function ceil(string $a, int $scale = 0): string
    {
        $factor = (new Number('1'))->mul((new Number('10'))->pow($scale));

        return bcadd((string) self::n($a)->mul($factor)->ceil()->div($factor, $scale), '0', $scale);
    }

    /**
     * Largest value with `$scale` decimals that is not above `$a` (2.9 -> 2 at scale 0).
     */
    public static function floor(string $a, int $scale = 0): string
    {
        $factor = (new Number('1'))->mul((new Number('10'))->pow($scale));

        return bcadd((string) self::n($a)->mul($factor)->floor()->div($factor, $scale), '0', $scale);
    }

    public static function max(string $a, string $b): string
    {
        return self::compare($a, $b) >= 0 ? $a : $b;
    }

    public static function min(string $a, string $b): string
    {
        return self::compare($a, $b) <= 0 ? $a : $b;
    }

    public static function round(string $a, int $scale): string
    {
        return self::fix(self::n($a), $scale);
    }

    private static function n(string $value): Number
    {
        if (! preg_match('/^-?\d+(\.\d+)?$/', $value)) {
            throw new InvalidArgumentException("[{$value}] is not a valid decimal number.");
        }

        return new Number($value);
    }

    private static function fix(Number $number, int $scale): string
    {
        return bcadd((string) $number->round($scale, self::ROUNDING), '0', $scale);
    }
}
