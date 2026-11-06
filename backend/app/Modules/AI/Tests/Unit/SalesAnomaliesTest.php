<?php

namespace App\Modules\AI\Tests\Unit;

use App\Modules\AI\Domain\Insights\SalesAnomalies;
use Carbon\CarbonImmutable;
use PHPUnit\Framework\TestCase;

/**
 * z-score anomalies on crafted series (hand-computed figures).
 */
class SalesAnomaliesTest extends TestCase
{
    /**
     * @param  list<string>  $values
     * @return array<string, string>
     */
    private function series(array $values, string $start = '2026-10-01'): array
    {
        $series = [];
        $day = CarbonImmutable::parse($start);
        foreach ($values as $value) {
            $series[$day->toDateString()] = $value;
            $day = $day->addDay();
        }

        return $series;
    }

    public function test_z_score_uses_the_sample_standard_deviation(): void
    {
        // History 2, 4, 4, 4, 5, 5, 7, 9 (n = 8): mean 5, Σ(x−μ)² = 32, sample variance 32/7, σ = 2.13809…
        $score = SalesAnomalies::zScore('12', ['2', '4', '4', '4', '5', '5', '7', '9'], 2);

        $this->assertNotNull($score);
        $this->assertSame('5.00000000', $score['mean']);
        $this->assertStringStartsWith('2.138089', $score['stddev']);
        // (12 − 5) ÷ 2.13809 = 3.27395…
        $this->assertStringStartsWith('3.27395', $score['z']);
    }

    public function test_a_spike_and_a_drop_are_flagged_and_normal_days_are_not(): void
    {
        // 20 days alternating 100 / 110 (μ = 105, σ ≈ 5.13), then 160 (spike), then 105, then 60 (drop).
        $values = [];
        for ($i = 0; $i < 20; $i++) {
            $values[] = $i % 2 === 0 ? '100.00' : '110.00';
        }
        $values[] = '160.00';
        $values[] = '105.00';
        $series = $this->series($values);
        $days = array_keys($series);

        $anomalies = SalesAnomalies::detect($series, [$days[20], $days[21]]);

        $this->assertCount(1, $anomalies);
        $this->assertSame($days[20], $anomalies[0]['date']);
        $this->assertSame('spike', $anomalies[0]['direction']);
        $this->assertSame('160.00', $anomalies[0]['value']);
        $this->assertSame('105.00', $anomalies[0]['mean']);
        $this->assertSame('5.13', $anomalies[0]['stddev']);
        // (160 − 105) ÷ 5.1299… = 10.72
        $this->assertSame('10.72', $anomalies[0]['z_score']);
        $this->assertSame(20, $anomalies[0]['history_days']);

        $values = array_slice($values, 0, 20);
        $values[] = '60.00';
        $series = $this->series($values);
        $drop = SalesAnomalies::detect($series, [array_key_last($series)]);
        $this->assertSame('drop', $drop[0]['direction']);
        $this->assertSame('-8.77', $drop[0]['z_score']);
    }

    public function test_the_threshold_is_inclusive_at_2_5(): void
    {
        // History of 14 days alternating 90 / 110: μ = 100, σ = √(14 × 100 ÷ 13) = 10.3775…
        $history = [];
        for ($i = 0; $i < 14; $i++) {
            $history[] = $i % 2 === 0 ? '90' : '110';
        }
        $below = SalesAnomalies::detect($this->series([...$history, '125.90']), ['2026-10-15']); // z ≈ 2.4957
        $above = SalesAnomalies::detect($this->series([...$history, '126.00']), ['2026-10-15']); // z ≈ 2.5054

        $this->assertSame([], $below);
        $this->assertCount(1, $above);
        $this->assertSame('10.38', $above[0]['stddev']);
        $this->assertSame('2.51', $above[0]['z_score']);
    }

    public function test_at_least_14_days_of_trading_history_are_needed(): void
    {
        // 30 days of zeros (shop not trading yet), then 13 trading days, then a spike: not enough history.
        $values = array_fill(0, 30, '0.00');
        for ($i = 0; $i < 13; $i++) {
            $values[] = $i % 2 === 0 ? '100.00' : '110.00';
        }
        $values[] = '500.00';
        $series = $this->series($values);
        $this->assertSame([], SalesAnomalies::detect($series, [array_key_last($series)]));

        // One more trading day before the spike → 14 days of history → flagged.
        array_splice($values, 43, 0, ['100.00']);
        $series = $this->series($values);
        $result = SalesAnomalies::detect($series, [array_key_last($series)]);
        $this->assertCount(1, $result);
        $this->assertSame(14, $result[0]['history_days']);
    }

    public function test_only_the_trailing_28_days_count_and_a_flat_history_never_flags(): void
    {
        // 40 days: the first 12 are huge, the last 28 alternate 100 / 110; the next day 160 is judged against the last 28 only.
        $values = array_fill(0, 12, '5000.00');
        for ($i = 0; $i < 28; $i++) {
            $values[] = $i % 2 === 0 ? '100.00' : '110.00';
        }
        $values[] = '160.00';
        $series = $this->series($values);
        $result = SalesAnomalies::detect($series, [array_key_last($series)]);
        $this->assertSame(28, $result[0]['history_days']);
        $this->assertSame('105.00', $result[0]['mean']);

        $flat = $this->series([...array_fill(0, 20, '100.00'), '900.00']);
        $this->assertSame([], SalesAnomalies::detect($flat, [array_key_last($flat)]));
        $this->assertNull(SalesAnomalies::zScore('900', array_fill(0, 20, '100')));
    }
}
