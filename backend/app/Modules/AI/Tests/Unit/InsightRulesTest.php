<?php

namespace App\Modules\AI\Tests\Unit;

use App\Modules\AI\Application\Insights\InsightsCalculator;
use App\Modules\AI\Application\Support\Figures;
use PHPUnit\Framework\TestCase;

/**
 * Periods, margin drop and return spike rules of the business insights.
 */
class InsightRulesTest extends TestCase
{
    public function test_periods(): void
    {
        $this->assertSame(['2026-11-06', '2026-11-06', '2026-11-05', '2026-11-05'], InsightsCalculator::periods('daily', '2026-11-06', '2026-11-07'));
        // A closed month vs the same number of days of the previous month (capped at its end).
        $this->assertSame(['2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30'], InsightsCalculator::periods('monthly', '2026-10-15', '2026-11-07'));
        $this->assertSame(['2026-03-01', '2026-03-31', '2026-02-01', '2026-02-28'], InsightsCalculator::periods('monthly', '2026-03-31', '2026-11-07'));
        // The running month: up to today.
        $this->assertSame(['2026-11-01', '2026-11-07', '2026-10-01', '2026-10-07'], InsightsCalculator::periods('monthly', '2026-11-01', '2026-11-07'));
    }

    public function test_margin_drop_is_flagged_at_five_points(): void
    {
        $this->assertTrue(InsightsCalculator::marginDrop('35.00', '40.00')['flagged']);
        $this->assertSame('-5.00', InsightsCalculator::marginDrop('35.00', '40.00')['change_points']);
        $this->assertFalse(InsightsCalculator::marginDrop('35.01', '40.00')['flagged']);
        $this->assertFalse(InsightsCalculator::marginDrop(null, '40.00')['flagged']);
    }

    public function test_return_spike_needs_five_percent_and_double_the_previous_rate(): void
    {
        $spike = InsightsCalculator::returnSpike(['gross_sales' => '1000.00', 'returns' => '80.00'], ['gross_sales' => '1000.00', 'returns' => '30.00']);
        $this->assertSame(['rate' => '8.00', 'previous_rate' => '3.00', 'returns' => '80.00', 'flagged' => true], $spike);
        $this->assertFalse(InsightsCalculator::returnSpike(['gross_sales' => '1000.00', 'returns' => '80.00'], ['gross_sales' => '1000.00', 'returns' => '50.00'])['flagged']);
        $this->assertFalse(InsightsCalculator::returnSpike(['gross_sales' => '1000.00', 'returns' => '40.00'], ['gross_sales' => '1000.00', 'returns' => '0.00'])['flagged']);
        $this->assertTrue(InsightsCalculator::returnSpike(['gross_sales' => '1000.00', 'returns' => '50.00'], ['gross_sales' => '0.00', 'returns' => '0.00'])['flagged']);
        $this->assertNull(InsightsCalculator::returnSpike(['gross_sales' => '0.00', 'returns' => '0.00'], [])['rate']);
    }

    public function test_figure_comparison(): void
    {
        $this->assertSame(['value' => '500.00', 'previous' => '150.00', 'change' => '350.00', 'change_pct' => '233.33'], Figures::compare('500.00', '150.00'));
        $this->assertSame(['value' => '0.00', 'previous' => '0.00', 'change' => '0.00', 'change_pct' => null], Figures::compare('0', '0'));
        $this->assertSame(['value' => 1, 'previous' => 2, 'change' => -1, 'change_pct' => '-50.00'], Figures::compare(1, 2));
        // A negative previous value: the change is relative to its magnitude.
        $this->assertSame(['value' => '0.00', 'previous' => '-50.00', 'change' => '50.00', 'change_pct' => '100.00'], Figures::compare('0.00', '-50.00'));
    }
}
