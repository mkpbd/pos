<?php

namespace App\Modules\Imports\Domain;

use DateTimeImmutable;
use DateTimeInterface;

/**
 * Reads one spreadsheet cell into the value a handler works with. Never uses floats for money:
 * numbers become plain decimal strings ("1,234.50" → "1234.50"); dates `YYYY-MM-DD` (also from
 * Excel date cells and Excel serial numbers); booleans from yes/no, true/false, 1/0.
 */
final class CellValue
{
    /** Excel's last valid serial (9999-12-31). */
    private const MAX_EXCEL_SERIAL = 2958465;

    /**
     * Raw cell → trimmed string (empty → null). Numbers keep their exact digits.
     */
    public static function text(mixed $raw): ?string
    {
        $value = match (true) {
            $raw === null => null,
            $raw instanceof DateTimeInterface => $raw->format('Y-m-d'),
            is_bool($raw) => $raw ? '1' : '0',
            is_int($raw) => (string) $raw,
            is_float($raw) => self::floatToString($raw),
            is_scalar($raw) => (string) $raw,
            default => null,
        };
        if ($value === null) {
            return null;
        }

        // Non-breaking spaces from copied web tables count as spaces.
        $value = trim(str_replace("\u{00A0}", ' ', $value));

        return $value === '' ? null : $value;
    }

    /**
     * @return array{0: string|bool|null, 1: ?string} [value, error message]
     */
    public static function read(ColumnType $type, mixed $raw): array
    {
        if ($type === ColumnType::Date) {
            return self::date($raw);
        }

        $text = self::text($raw);
        if ($text === null) {
            return [null, null];
        }

        return match ($type) {
            ColumnType::Text => [$text, null],
            ColumnType::Decimal => ($d = self::decimal($text)) === null ? [null, 'Enter a number such as 1234.50.'] : [$d, null],
            ColumnType::Integer => ($i = self::integer($text)) === null ? [null, 'Enter a whole number.'] : [$i, null],
            ColumnType::Boolean => ($b = self::boolean($text)) === null ? [null, 'Enter yes or no.'] : [$b, null],
        };
    }

    /**
     * "1234.5", "-3", "1,234.50", ".5", "1 234" → plain decimal string; anything else null.
     */
    public static function decimal(string $text): ?string
    {
        $value = str_replace([' ', "\u{00A0}", "\u{202F}"], '', $text);
        if (preg_match('/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/', $value) === 1) {
            $value = str_replace(',', '', $value);
        }
        if (preg_match('/^([+-]?)(\d*)(?:\.(\d+))?$/', $value, $m) !== 1 || ($m[2] === '' && ($m[3] ?? '') === '')) {
            return null;
        }

        $integer = ltrim($m[2], '0');
        $result = ($integer === '' ? '0' : $integer).(isset($m[3]) && $m[3] !== '' ? '.'.$m[3] : '');

        return ($m[1] === '-' && preg_match('/[1-9]/', $result) === 1 ? '-' : '').$result;
    }

    /**
     * Digits after the decimal point of a plain decimal string ("12.50" → 2).
     */
    public static function scaleOf(string $decimal): int
    {
        $dot = strpos($decimal, '.');

        return $dot === false ? 0 : strlen($decimal) - $dot - 1;
    }

    public static function integer(string $text): ?string
    {
        $decimal = self::decimal($text);
        if ($decimal === null || preg_match('/^(-?\d+)(?:\.0+)?$/', $decimal, $m) !== 1) {
            return null;
        }

        return $m[1];
    }

    public static function boolean(string $text): ?bool
    {
        return match (mb_strtolower(trim($text))) {
            'yes', 'y', 'true', '1', 'active' => true,
            'no', 'n', 'false', '0', 'inactive' => false,
            default => null,
        };
    }

    /**
     * @return array{0: ?string, 1: ?string}
     */
    public static function date(mixed $raw): array
    {
        if ($raw instanceof DateTimeInterface) {
            return [$raw->format('Y-m-d'), null];
        }

        $text = self::text($raw);
        if ($text === null) {
            return [null, null];
        }

        if (preg_match('/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/', $text, $m) === 1) {
            return checkdate((int) $m[2], (int) $m[3], (int) $m[1])
                ? [sprintf('%04d-%02d-%02d', $m[1], $m[2], $m[3]), null]
                : [null, 'This date does not exist.'];
        }

        // An Excel serial number (a date cell saved as a plain number), whole days only.
        if (preg_match('/^\d+(\.0+)?$/', $text) === 1 && (int) $text >= 1 && (int) $text <= self::MAX_EXCEL_SERIAL) {
            return [self::fromExcelSerial((int) $text), null];
        }

        return [null, 'Enter the date as YYYY-MM-DD.'];
    }

    /**
     * Excel's 1900 date system: serial 1 = 1900-01-01, and Excel counts the non-existent
     * 1900-02-29 (serial 60), so later serials are one day ahead of a plain day count.
     */
    public static function fromExcelSerial(int $serial): string
    {
        $base = new DateTimeImmutable($serial >= 61 ? '1899-12-30' : '1899-12-31');

        return $base->modify("+{$serial} days")->format('Y-m-d');
    }

    /**
     * A spreadsheet number cell as a decimal string without binary noise (12.3, not 12.300000000000001).
     */
    private static function floatToString(float $value): string
    {
        if (! is_finite($value)) {
            return '';
        }
        $text = rtrim(rtrim(number_format($value, 10, '.', ''), '0'), '.');

        return $text === '-0' ? '0' : $text;
    }
}
