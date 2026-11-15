<?php

namespace App\Modules\Storefront\Domain\Festivals;

use Carbon\CarbonImmutable;

/**
 * B17: the festival calendar of Bangladesh stores — ten occasions with their dates. Pure (no
 * clock, no database): callers pass "today" in the store's time zone.
 *
 * Kinds:
 * - `fixed`: the same Gregorian date every year (Pohela Boishakh is 14 April in Bangladesh's
 *   revised Bengali calendar; Ekushey 21 February; Independence Day 26 March; Victory Day
 *   16 December; 11.11 on 11 November) — computed for any year.
 * - `season`: a stretch of dates every year (the winter sale, 1 December – 31 January).
 * - `lunar`: Ramadan and the two Eids follow the Hijri calendar and the moon sighting in
 *   Bangladesh; Durga Puja follows the tithi of the Bengali panjika. Their dates are a bundled
 *   table for 2026–2028, always marked `expected`.
 *
 * Sources of the bundled table (checked 2026-11-15):
 * - 2026: the government's public holiday list for 2026 (Ministry of Public Administration, as
 *   published by The Daily Star and Prothom Alo): Eid ul-Fitr 21 March (Ramadan from 19
 *   February), Eid ul-Adha 28 May, Durga Puja Nabami 20 / Bijoya Dashami 21 October.
 * - 2027: the government's public holiday list for 2027 (cabinet approval 2 November 2026, as
 *   published by Prothom Alo / The Financial Express): Shab-e-Qadr 7 March (so Ramadan from
 *   9 February), Eid ul-Fitr 10 March, Eid ul-Adha 17 May, Nabami 9 / Bijoya Dashami 10 October.
 * - 2028: no government list yet — calculated dates (bangladatetoday.com's 2028 calendar and the
 *   astronomical new moons with Bangladesh's usual sighting a day after Saudi Arabia):
 *   Shab-e-Qadr 24 February (Ramadan from 29 January), Eid ul-Fitr 27 February, Eid ul-Adha
 *   6 May, Durga Puja 24–28 September (Bijoya Dashami 28 September).
 * The Eids span the three days of Eid; Durga Puja Shashthi to Bijoya Dashami.
 */
final class FestivalCalendar
{
    public const KINDS = ['fixed', 'lunar', 'season'];

    /**
     * key => name, Bangla name, kind, whether sale wording suits it (Ekushey is a tribute:
     * no sale wording by default), days the suggested campaign starts before the occasion, and
     * the date rule of fixed / season occasions (`MM-DD`; a season ending on an earlier day
     * than it starts ends in the next year).
     *
     * @var array<string, array{name: string, name_bn: string, kind: string, sale_wording: bool, lead_days: int, on?: string, until?: string}>
     */
    public const OCCASIONS = [
        'eid-ul-fitr' => ['name' => 'Eid ul-Fitr', 'name_bn' => 'ঈদুল ফিতর', 'kind' => 'lunar', 'sale_wording' => true, 'lead_days' => 14],
        'eid-ul-adha' => ['name' => 'Eid ul-Adha', 'name_bn' => 'ঈদুল আযহা', 'kind' => 'lunar', 'sale_wording' => true, 'lead_days' => 10],
        'ramadan' => ['name' => 'Ramadan', 'name_bn' => 'রমজান', 'kind' => 'lunar', 'sale_wording' => true, 'lead_days' => 3],
        'durga-puja' => ['name' => 'Durga Puja', 'name_bn' => 'দুর্গাপূজা', 'kind' => 'lunar', 'sale_wording' => true, 'lead_days' => 7],
        'pohela-boishakh' => ['name' => 'Pohela Boishakh', 'name_bn' => 'পহেলা বৈশাখ', 'kind' => 'fixed', 'sale_wording' => true, 'lead_days' => 7, 'on' => '04-14'],
        'ekushey' => ['name' => 'Ekushey February (International Mother Language Day)', 'name_bn' => 'একুশে ফেব্রুয়ারি (আন্তর্জাতিক মাতৃভাষা দিবস)', 'kind' => 'fixed', 'sale_wording' => false, 'lead_days' => 1, 'on' => '02-21'],
        'independence-day' => ['name' => 'Independence Day', 'name_bn' => 'স্বাধীনতা দিবস', 'kind' => 'fixed', 'sale_wording' => true, 'lead_days' => 3, 'on' => '03-26'],
        'victory-day' => ['name' => 'Victory Day', 'name_bn' => 'বিজয় দিবস', 'kind' => 'fixed', 'sale_wording' => true, 'lead_days' => 7, 'on' => '12-16'],
        'winter-sale' => ['name' => 'Winter sale', 'name_bn' => 'শীতের সেল', 'kind' => 'season', 'sale_wording' => true, 'lead_days' => 0, 'on' => '12-01', 'until' => '01-31'],
        'eleven-eleven' => ['name' => '11.11 sale', 'name_bn' => '১১.১১ সেল', 'kind' => 'fixed', 'sale_wording' => true, 'lead_days' => 3, 'on' => '11-11'],
    ];

    /**
     * The bundled expected dates of the lunar / tithi occasions: key => year => [first day,
     * last day] (see the class comment for the sources).
     *
     * @var array<string, array<int, array{0: string, 1: string}>>
     */
    public const LUNAR_DATES = [
        'ramadan' => [2026 => ['2026-02-19', '2026-03-20'], 2027 => ['2027-02-09', '2027-03-09'], 2028 => ['2028-01-29', '2028-02-26']],
        'eid-ul-fitr' => [2026 => ['2026-03-21', '2026-03-23'], 2027 => ['2027-03-10', '2027-03-12'], 2028 => ['2028-02-27', '2028-02-29']],
        'eid-ul-adha' => [2026 => ['2026-05-28', '2026-05-30'], 2027 => ['2027-05-17', '2027-05-19'], 2028 => ['2028-05-06', '2028-05-08']],
        'durga-puja' => [2026 => ['2026-10-17', '2026-10-21'], 2027 => ['2027-10-06', '2027-10-10'], 2028 => ['2028-09-24', '2028-09-28']],
    ];

    /** Years a fixed or season occasion may be set up for. */
    public const YEARS = [2026, 2100];

    /** A campaign window is at most this many days. */
    public const MAX_WINDOW_DAYS = 60;

    /** How far ahead the calendar looks. */
    public const LOOKAHEAD_MONTHS = 12;

    public static function exists(string $key): bool
    {
        return isset(self::OCCASIONS[$key]);
    }

    /**
     * The occasion in a year: `{year, starts_on, ends_on, expected, note, note_bn}` (dates
     * `Y-m-d`), or null when the year has no known date (lunar occasions outside the table).
     *
     * @return array{year: int, starts_on: string, ends_on: string, expected: bool, note: ?string, note_bn: ?string}|null
     */
    public static function occurrence(string $key, int $year): ?array
    {
        $occasion = self::OCCASIONS[$key] ?? null;
        if ($occasion === null) {
            return null;
        }
        if ($occasion['kind'] === 'lunar') {
            $dates = self::LUNAR_DATES[$key][$year] ?? null;
            if ($dates === null) {
                return null;
            }
            $panjika = $key === 'durga-puja';

            return [
                'year' => $year,
                'starts_on' => $dates[0],
                'ends_on' => $dates[1],
                'expected' => true,
                'note' => $panjika ? 'Expected dates — confirm with the panjika.' : 'Expected date — confirm with the moon sighting.',
                'note_bn' => $panjika ? 'সম্ভাব্য তারিখ — পঞ্জিকা দেখে নিশ্চিত করুন।' : 'সম্ভাব্য তারিখ — চাঁদ দেখার ওপর নির্ভর করে।',
            ];
        }
        if ($year < self::YEARS[0] || $year > self::YEARS[1]) {
            return null;
        }
        $start = sprintf('%04d-%s', $year, $occasion['on']);
        $until = $occasion['until'] ?? $occasion['on'];
        $end = sprintf('%04d-%s', $until < $occasion['on'] ? $year + 1 : $year, $until);

        return ['year' => $year, 'starts_on' => $start, 'ends_on' => $end, 'expected' => false, 'note' => null, 'note_bn' => null];
    }

    /**
     * The occasion's next occurrence seen from `$today` (a date in the store's time zone): the
     * first one that has not ended and starts within the next 12 months; null when there is
     * none (a lunar occasion past the bundled table).
     *
     * @return array{year: int, starts_on: string, ends_on: string, expected: bool, note: ?string, note_bn: ?string}|null
     */
    public static function next(string $key, CarbonImmutable $today): ?array
    {
        $date = $today->toDateString();
        $horizon = $today->addMonthsNoOverflow(self::LOOKAHEAD_MONTHS)->toDateString();
        for ($year = $today->year - 1; $year <= $today->year + 1; $year++) {
            $occurrence = self::occurrence($key, $year);
            if ($occurrence !== null && $occurrence['ends_on'] >= $date && $occurrence['starts_on'] <= $horizon) {
                return $occurrence;
            }
        }

        return null;
    }

    /**
     * The suggested campaign window in `$timezone`: from `lead_days` before the first day (not
     * before today) to the end of the last day, at most MAX_WINDOW_DAYS long (cut at the end).
     *
     * @param  array{starts_on: string, ends_on: string}  $occurrence
     * @return array{starts_at: CarbonImmutable, ends_at: CarbonImmutable}
     */
    public static function suggestedWindow(string $key, array $occurrence, CarbonImmutable $today, string $timezone): array
    {
        $startsAt = CarbonImmutable::parse($occurrence['starts_on'], $timezone)->startOfDay()->subDays(self::OCCASIONS[$key]['lead_days']);
        $todayStart = CarbonImmutable::parse($today->toDateString(), $timezone)->startOfDay();
        if ($startsAt->lt($todayStart)) {
            $startsAt = $todayStart;
        }
        $endsAt = CarbonImmutable::parse($occurrence['ends_on'], $timezone)->endOfDay()->startOfSecond();
        $limit = $startsAt->addDays(self::MAX_WINDOW_DAYS)->subSecond();
        if ($endsAt->gt($limit)) {
            $endsAt = $limit;
        }

        return ['starts_at' => $startsAt, 'ends_at' => $endsAt];
    }
}
