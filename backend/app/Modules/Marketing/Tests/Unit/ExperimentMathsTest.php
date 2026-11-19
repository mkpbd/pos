<?php

namespace App\Modules\Marketing\Tests\Unit;

use App\Modules\Marketing\Application\Queries\ExperimentResults;
use App\Modules\Marketing\Domain\BetaBinomial;
use Carbon\CarbonImmutable;
use PHPUnit\Framework\TestCase;

/**
 * B13: the Bayesian chance that version B beats A (Beta-Binomial, exact closed form with a
 * normal approximation for very large counts) and the verdict built on it.
 */
class ExperimentMathsTest extends TestCase
{
    public function test_log_gamma_matches_known_values(): void
    {
        $this->assertEqualsWithDelta(0.0, BetaBinomial::logGamma(1), 1e-12);
        $this->assertEqualsWithDelta(log(24), BetaBinomial::logGamma(5), 1e-10);
        $this->assertEqualsWithDelta(log(sqrt(M_PI)), BetaBinomial::logGamma(0.5), 1e-10);
        $this->assertEqualsWithDelta(363.73937555556347, BetaBinomial::logGamma(101), 1e-8);
    }

    public function test_probability_that_b_beats_a(): void
    {
        // Equal data: a coin toss either way.
        $this->assertEqualsWithDelta(0.5, BetaBinomial::probabilityBBeatsA(100, 10, 100, 10), 1e-9);
        $this->assertEqualsWithDelta(0.5, BetaBinomial::probabilityBBeatsA(0, 0, 0, 0), 1e-9);
        // Beta(2,1) vs Beta(1,1): P(X > Y) for X ~ Beta(1,1) (A), Y ~ Beta(2,1) (B) = 2/3.
        $this->assertEqualsWithDelta(2 / 3, BetaBinomial::probabilityBBeatsA(0, 0, 1, 1), 1e-9);
        // Symmetry: P(B > A) + P(A > B) = 1.
        $p = BetaBinomial::probabilityBBeatsA(120, 12, 110, 19);
        $this->assertEqualsWithDelta(1.0, $p + BetaBinomial::probabilityBBeatsA(110, 19, 120, 12), 1e-9);
        // 10 % vs 20 % of 100 visitors: B is very likely better (≈ 97.5 %).
        $clear = BetaBinomial::probabilityBBeatsA(100, 10, 100, 20);
        $this->assertGreaterThan(0.96, $clear);
        $this->assertLessThan(0.99, $clear);
        // Conversions are capped at the visitors.
        $this->assertEqualsWithDelta(BetaBinomial::probabilityBBeatsA(10, 10, 10, 5), BetaBinomial::probabilityBBeatsA(10, 50, 10, 5), 1e-12);
        // Very large counts take the normal approximation, close to the exact value.
        $exact = BetaBinomial::probabilityBBeatsA(200000, 20000, 200000, 20000 - 300);
        $approx = BetaBinomial::probabilityBBeatsA(200000, 20000 - 300, 200000, 20001);
        $this->assertLessThan(0.1, $exact);
        $this->assertGreaterThan(0.9, $approx);
        $this->assertEqualsWithDelta(1.0, $exact + $approx, 0.02);
    }

    public function test_verdict(): void
    {
        $this->assertSame(
            ['lift' => null, 'probability_b_beats_a' => null, 'confidence' => 'low', 'enough_data' => false, 'recommendation' => 'keep_running'],
            ExperimentResults::verdict(0, 0, 10, 1),
        );
        // Clearly better, with enough data.
        $b = ExperimentResults::verdict(1000, 50, 1000, 90);
        $this->assertSame(['80.00', 'high', true, 'keep_b'], [$b['lift'], $b['confidence'], $b['enough_data'], $b['recommendation']]);
        $this->assertGreaterThan(99, (float) $b['probability_b_beats_a']);
        $a = ExperimentResults::verdict(1000, 90, 1000, 50);
        $this->assertSame(['-44.44', 'high', 'keep_a'], [$a['lift'], $a['confidence'], $a['recommendation']]);
        // Too few goal events: never a recommendation, low confidence.
        $few = ExperimentResults::verdict(1000, 2, 1000, 9);
        $this->assertSame([false, 'low', 'keep_running'], [$few['enough_data'], $few['confidence'], $few['recommendation']]);
        // Close: keep running, medium or low.
        $close = ExperimentResults::verdict(500, 50, 500, 58);
        $this->assertSame('keep_running', $close['recommendation']);
        $this->assertContains($close['confidence'], ['low', 'medium']);
        $this->assertSame('16.00', $close['lift']);
    }

    public function test_range_follows_the_test(): void
    {
        $tz = 'Asia/Dhaka';
        $today = CarbonImmutable::now($tz)->toDateString();
        [$from, $to] = ExperimentResults::range(['started_at' => null, 'ended_at' => null], $tz);
        $this->assertSame([CarbonImmutable::parse($today)->subDays(29)->toDateString(), $today], [$from, $to]);
        $this->assertSame(['2026-01-02', '2026-01-10'], ExperimentResults::range(['started_at' => '2026-01-01T20:00:00Z', 'ended_at' => '2026-01-10T10:00:00Z'], $tz));
        [$from] = ExperimentResults::range(['started_at' => '2020-01-01T00:00:00Z', 'ended_at' => '2026-01-10T10:00:00Z'], $tz);
        $this->assertSame('2025-01-11', $from);
    }
}
