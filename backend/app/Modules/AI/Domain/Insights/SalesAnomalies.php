<?php

namespace App\Modules\AI\Domain\Insights;

use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * Unusual sales days (pure, exact decimal arithmetic with bcmath — no floats):
 *
 *   for a day d with value x, the history is the trailing window of up to 28 days before d,
 *   counted only from the first active day of the series (a day with sales ≠ 0) — days before
 *   the shop started trading are not history;
 *   with at least 14 history days: mean μ, sample standard deviation σ (n − 1),
 *   z = (x − μ) ÷ σ; the day is an anomaly when |z| ≥ 2.5 (spike when z > 0, drop when z < 0).
 *   σ = 0 (a perfectly flat history) never flags.
 */
final class SalesAnomalies
{
    public const WINDOW_DAYS = 28;

    public const MIN_HISTORY_DAYS = 14;

    public const THRESHOLD = '2.5';

    private const SCALE = 8;

    /**
     * @param  array<string, string>  $series  date (Y-m-d, ascending, every day present) => net sales
     * @param  list<string>  $dates  the days to check
     * @return list<array{date: string, value: string, mean: string, stddev: string, z_score: string, direction: string, history_days: int}>
     */
    public static function detect(array $series, array $dates, int $window = self::WINDOW_DAYS, int $minHistory = self::MIN_HISTORY_DAYS, string $threshold = self::THRESHOLD): array
    {
        $days = array_keys($series);
        $firstActive = null;
        foreach ($days as $i => $day) {
            if (bccomp(self::plain($series[$day]), '0', self::SCALE) !== 0) {
                $firstActive = $i;
                break;
            }
        }
        $positions = array_flip($days);

        $anomalies = [];
        foreach ($dates as $date) {
            if (! isset($positions[$date]) || $firstActive === null) {
                continue;
            }
            $at = $positions[$date];
            $start = max($firstActive, $at - $window);
            $history = [];
            for ($i = $start; $i < $at; $i++) {
                $history[] = self::plain($series[$days[$i]]);
            }
            $score = self::zScore(self::plain($series[$date]), $history, $minHistory);
            if ($score === null || bccomp(self::abs($score['z']), $threshold, self::SCALE) < 0) {
                continue;
            }
            $anomalies[] = [
                'date' => $date,
                'value' => self::round($series[$date], 2),
                'mean' => self::round($score['mean'], 2),
                'stddev' => self::round($score['stddev'], 2),
                'z_score' => self::round($score['z'], 2),
                'direction' => bccomp($score['z'], '0', self::SCALE) > 0 ? 'spike' : 'drop',
                'history_days' => count($history),
            ];
        }

        return $anomalies;
    }

    /**
     * z-score of $value against $history; null with too little history or σ = 0.
     *
     * @param  list<string>  $history
     * @return array{mean: string, stddev: string, z: string}|null
     */
    public static function zScore(string $value, array $history, int $minHistory = self::MIN_HISTORY_DAYS): ?array
    {
        $n = count($history);
        if ($n < max(2, $minHistory)) {
            return null;
        }
        $sum = '0';
        foreach ($history as $x) {
            $sum = bcadd($sum, self::plain($x), self::SCALE);
        }
        $mean = bcdiv($sum, (string) $n, self::SCALE);
        $squares = '0';
        foreach ($history as $x) {
            $d = bcsub(self::plain($x), $mean, self::SCALE);
            $squares = bcadd($squares, bcmul($d, $d, self::SCALE), self::SCALE);
        }
        $variance = bcdiv($squares, (string) ($n - 1), self::SCALE);
        $stddev = bcsqrt($variance, self::SCALE);
        if (bccomp($stddev, '0', self::SCALE) === 0) {
            return null;
        }

        return [
            'mean' => $mean,
            'stddev' => $stddev,
            'z' => bcdiv(bcsub(self::plain($value), $mean, self::SCALE), $stddev, self::SCALE),
        ];
    }

    private static function abs(string $value): string
    {
        return ltrim($value, '-');
    }

    private static function round(string $value, int $scale): string
    {
        return Decimal::round(self::plain($value), $scale);
    }

    private static function plain(string $value): string
    {
        $value = trim($value);

        return $value === '' ? '0' : $value;
    }
}
