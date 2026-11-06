<?php

namespace App\Modules\Reports\Application\Support;

use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Carbon\CarbonImmutable;
use DateTimeZone;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/**
 * Driver-aware SQL fragments for the report queries, so the same aggregate SQL runs on
 * PostgreSQL (production) and SQLite (tests):
 *
 * - local calendar day / month of a timestamptz column in the organization's timezone —
 *   PostgreSQL `AT TIME ZONE '<tz>'` (exact, DST-aware); SQLite shifts by the zone's UTC offset
 *   at the start of the report range (exact for zones without DST such as Asia/Dhaka);
 * - day / month of a business-date column (stored as dates);
 * - instants bound with an explicit UTC offset on PostgreSQL (the session zone never matters);
 * - aggregates read back as exact decimal strings (SQLite returns floats; PostgreSQL NUMERIC
 *   strings) — rounding happens once, in PHP, on Decimal.
 *
 * The timezone is validated against the IANA list before it is inlined (it cannot be bound:
 * PostgreSQL treats differently-parameterized GROUP BY expressions as different).
 */
final class Sql
{
    private function __construct(
        public readonly string $timezone,
        private readonly string $driver,
        private readonly int $offsetMinutes,
    ) {}

    public static function for(string $timezone, ?CarbonImmutable $at = null): self
    {
        if ($timezone !== 'UTC' && ! in_array($timezone, DateTimeZone::listIdentifiers(), true)) {
            throw new InvalidArgumentException("Unknown timezone [{$timezone}].");
        }
        $at ??= CarbonImmutable::now($timezone);

        return new self($timezone, DB::getDriverName(), (int) $at->setTimezone($timezone)->utcOffset());
    }

    public function isPostgres(): bool
    {
        return $this->driver === 'pgsql';
    }

    /** Organization-local day (YYYY-MM-DD) of a timestamptz column. */
    public function localDate(string $column): string
    {
        return $this->isPostgres()
            ? "to_char(({$column} AT TIME ZONE '{$this->timezone}'), 'YYYY-MM-DD')"
            : "strftime('%Y-%m-%d', {$column}, '{$this->modifier()}')";
    }

    /** Organization-local month (YYYY-MM) of a timestamptz column. */
    public function localMonth(string $column): string
    {
        return $this->isPostgres()
            ? "to_char(({$column} AT TIME ZONE '{$this->timezone}'), 'YYYY-MM')"
            : "strftime('%Y-%m', {$column}, '{$this->modifier()}')";
    }

    /** Day (YYYY-MM-DD) of a business-date column. */
    public function date(string $column): string
    {
        return $this->isPostgres() ? "to_char({$column}, 'YYYY-MM-DD')" : "substr({$column}, 1, 10)";
    }

    /** Month (YYYY-MM) of a business-date column. */
    public function month(string $column): string
    {
        return $this->isPostgres() ? "to_char({$column}, 'YYYY-MM')" : "substr({$column}, 1, 7)";
    }

    /** A bound instant for comparisons with timestamptz columns. */
    public function instant(CarbonImmutable $instant): string
    {
        $utc = $instant->setTimezone('UTC');

        return $this->isPostgres() ? $utc->format('Y-m-d H:i:sP') : $utc->format('Y-m-d H:i:s');
    }

    /**
     * A boolean column as a condition that holds only for true (NULL and false are false).
     */
    public function isTrue(string $column): string
    {
        return $this->isPostgres() ? "COALESCE({$column}, false) = true" : "COALESCE({$column}, 0) = 1";
    }

    private function modifier(): string
    {
        return sprintf('%+d minutes', $this->offsetMinutes);
    }

    /** An aggregate as an exact money string (2 decimals). */
    public static function money(mixed $value): string
    {
        return Decimal::round(self::plain($value), 2);
    }

    /** An aggregate as an exact quantity string (3 decimals). */
    public static function quantity(mixed $value): string
    {
        return Decimal::round(self::plain($value), 3);
    }

    /** An aggregate as a plain decimal string (no exponent). */
    public static function plain(mixed $value): string
    {
        if ($value === null || $value === '') {
            return '0';
        }
        if (is_int($value)) {
            return (string) $value;
        }
        if (is_float($value)) {
            // SQLite sums: keep 6 decimals, then the caller rounds to its scale.
            return rtrim(rtrim(number_format($value, 6, '.', ''), '0'), '.') ?: '0';
        }
        $value = trim((string) $value);
        if (preg_match('/[eE]/', $value) === 1) {
            return rtrim(rtrim(number_format((float) $value, 6, '.', ''), '0'), '.') ?: '0';
        }

        return $value;
    }

    /**
     * a ÷ b × 100 with 2 decimals, or null when b is zero.
     */
    public static function percent(string $part, string $whole): ?string
    {
        if (Decimal::compare($whole, '0') === 0) {
            return null;
        }

        return Decimal::round(Decimal::div(Decimal::mul($part, '100', 8), $whole, 8), 2);
    }
}
