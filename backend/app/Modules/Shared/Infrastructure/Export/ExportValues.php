<?php

namespace App\Modules\Shared\Infrastructure\Export;

use App\Modules\Shared\Domain\ValueObjects\Decimal;
use BackedEnum;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Support\Str;
use Throwable;

/**
 * Normalizes presented values for both writers: exact decimal strings (never floats), instants
 * in the organization's timezone, readable statuses and plain text.
 */
final class ExportValues
{
    /**
     * A decimal string ("1234.50", "-3") or null when the value is not numeric.
     */
    public static function decimal(mixed $value): ?string
    {
        if (is_int($value)) {
            return (string) $value;
        }
        if (is_float($value)) {
            // Only reached when a presenter hands out a float; keep its exact textual form.
            $value = rtrim(rtrim(sprintf('%.6F', $value), '0'), '.');
        }
        if (! is_string($value)) {
            return null;
        }
        $value = trim($value);
        if (str_starts_with($value, '+')) {
            $value = substr($value, 1);
        }

        return preg_match('/^-?\d+(\.\d+)?$/', $value) === 1 ? $value : null;
    }

    /**
     * "1234567.5" → "1,234,567.50" (scale 2), exact.
     */
    public static function grouped(string $decimal, int $scale): string
    {
        $rounded = Decimal::round($decimal, $scale);
        $negative = str_starts_with($rounded, '-');
        [$whole, $fraction] = array_pad(explode('.', ltrim($rounded, '-'), 2), 2, '');
        $whole = strrev(implode(',', str_split(strrev($whole), 3)));
        $text = $fraction === '' ? $whole : $whole.'.'.$fraction;

        return $negative && trim($text, '0.,') !== '' ? '-'.$text : $text;
    }

    /**
     * Quantities: up to 3 decimals, trailing zeros dropped ("2.500" → "2.5", "4.000" → "4").
     */
    public static function quantity(string $decimal): string
    {
        $text = self::grouped($decimal, 3);

        return str_contains($text, '.') ? rtrim(rtrim($text, '0'), '.') : $text;
    }

    /**
     * An instant in the given timezone. Calendar dates ("2026-11-05") are taken as they are;
     * timestamps are converted from UTC (or their own offset).
     */
    public static function instant(mixed $value, string $timezone): ?CarbonImmutable
    {
        if ($value instanceof DateTimeInterface) {
            return CarbonImmutable::instance($value)->setTimezone($timezone);
        }
        if (! is_string($value) || trim($value) === '') {
            return null;
        }
        try {
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) === 1) {
                return CarbonImmutable::createFromFormat('!Y-m-d', $value, $timezone) ?: null;
            }

            return CarbonImmutable::parse($value, 'UTC')->setTimezone($timezone);
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * "partially_received" → "Partially received".
     */
    public static function status(mixed $value): ?string
    {
        $value = $value instanceof BackedEnum ? $value->value : $value;
        if ($value === null || $value === '') {
            return null;
        }

        return Str::ucfirst(str_replace(['_', '-'], ' ', (string) $value));
    }

    public static function text(mixed $value): ?string
    {
        return match (true) {
            $value === null => null,
            is_bool($value) => $value ? 'Yes' : 'No',
            $value instanceof BackedEnum => (string) $value->value,
            $value instanceof DateTimeInterface => $value->format('Y-m-d H:i'),
            is_array($value) => implode(', ', array_map(fn ($v) => (string) self::text($v), array_filter($value, fn ($v) => $v !== null && $v !== ''))),
            is_scalar($value) => (string) $value,
            default => null,
        };
    }
}
