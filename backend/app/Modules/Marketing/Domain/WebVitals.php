<?php

namespace App\Modules\Marketing\Domain;

/**
 * B15: real-user Web Vitals as histograms, so the 75th percentile of any range and device can be
 * computed from daily counts (no single measurement is kept).
 *
 * Bucket b of a metric holds the values in ((b − 1) × step, b × step]; a bucket's value is its
 * upper edge, so the "good" / "poor" thresholds fall exactly on bucket edges:
 * - LCP (largest contentful paint, ms): step 100, up to 10 s (bucket 100 = 10 s or more);
 *   good ≤ 2500, poor > 4000.
 * - INP (interaction to next paint, ms): step 25, up to 2 s; good ≤ 200, poor > 500.
 * - CLS (cumulative layout shift): step 0.01, up to 1.0; good ≤ 0.1, poor > 0.25.
 * Values outside 0 … 60 000 ms (LCP, INP) or 0 … 10 (CLS) are ignored.
 */
final class WebVitals
{
    /** metric => [step, last bucket, largest accepted value, good up to bucket, poor above bucket] */
    private const METRICS = [
        'lcp' => [100, 100, 60000, 25, 40],
        'inp' => [25, 80, 60000, 8, 20],
        'cls' => [0.01, 100, 10, 10, 25],
    ];

    public const METRICS_LIST = ['lcp', 'cls', 'inp'];

    public const GOOD = 'good';

    public const NEEDS_IMPROVEMENT = 'needs_improvement';

    public const POOR = 'poor';

    /**
     * The bucket of a measured value, or null when the value is not a plausible measurement.
     */
    public static function bucket(string $metric, mixed $value): ?int
    {
        $spec = self::METRICS[$metric] ?? null;
        if ($spec === null || (! is_int($value) && ! is_float($value)) || ! is_finite((float) $value) || $value < 0 || $value > $spec[2]) {
            return null;
        }
        // CLS in ten-thousandths first, so 0.1 lands in bucket 10 (not 11 through float error).
        $bucket = $metric === 'cls'
            ? (int) ceil(round((float) $value * 10000) / 100)
            : (int) ceil(round((float) $value, 3) / $spec[0]);

        return min($bucket, $spec[1]);
    }

    /**
     * The 75th percentile bucket of a histogram (bucket => samples), or null without samples.
     *
     * @param  array<int, int>  $histogram
     */
    public static function p75(array $histogram): ?int
    {
        ksort($histogram);
        $total = array_sum($histogram);
        if ($total <= 0) {
            return null;
        }
        $target = (int) ceil($total * 0.75);
        $seen = 0;
        foreach ($histogram as $bucket => $samples) {
            $seen += $samples;
            if ($seen >= $target) {
                return (int) $bucket;
            }
        }

        return (int) array_key_last($histogram);
    }

    /**
     * A bucket's value: milliseconds for LCP and INP, a 3-decimal string for CLS.
     */
    public static function value(string $metric, int $bucket): int|string
    {
        return $metric === 'cls'
            ? number_format($bucket / 100, 3, '.', '')
            : $bucket * (int) self::METRICS[$metric][0];
    }

    /**
     * Google's rating of a bucket: good, needs_improvement or poor.
     */
    public static function rating(string $metric, int $bucket): string
    {
        [, , , $good, $poor] = self::METRICS[$metric];

        return match (true) {
            $bucket <= $good => self::GOOD,
            $bucket <= $poor => self::NEEDS_IMPROVEMENT,
            default => self::POOR,
        };
    }
}
