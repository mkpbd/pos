<?php

namespace App\Modules\Purchasing\Tests\Unit;

use App\Modules\Purchasing\Domain\Performance\SupplierScore;
use PHPUnit\Framework\TestCase;

class SupplierScoreTest extends TestCase
{
    public function test_all_metrics_use_the_full_weights(): void
    {
        $score = SupplierScore::compute('50.00', '80.00', '18.75', '29.69', '100.00');

        // 35×50 + 30×80 + 15×(100 − 5×18.75) + 10×0 (+29.69 % → 0) + 10×100 = 5243.75 / 100.
        $this->assertSame(52, $score['score']);
        $this->assertSame(['on_time' => '50.00', 'fill' => '80.00', 'returns' => '6.25', 'price_stability' => '0.00', 'responsiveness' => '100.00'], $score['components']);
        $this->assertSame(100, array_sum($score['weights']));
    }

    public function test_missing_metrics_are_left_out_and_the_rest_reweighted(): void
    {
        // (35×100 + 30×50) / 65 = 76.92 → 77.
        $this->assertSame(77, SupplierScore::compute('100.00', '50.00', null, null, null)['score']);
        $this->assertSame(['on_time' => 35, 'fill' => 30], SupplierScore::compute('100.00', '50.00', null, null, null)['weights']);
        // Only responsiveness known.
        $this->assertSame(0, SupplierScore::compute(null, null, null, null, '0.00')['score']);
        $this->assertNull(SupplierScore::compute(null, null, null, null, null)['score']);
    }

    public function test_price_decreases_count_as_stable_and_returns_are_penalised(): void
    {
        $this->assertSame('100.00', SupplierScore::compute(null, null, null, '-12.50', null)['components']['price_stability']);
        $this->assertSame('80.00', SupplierScore::compute(null, null, null, '4.00', null)['components']['price_stability']);
        $this->assertSame('90.00', SupplierScore::compute(null, null, '2.00', null, null)['components']['returns']);
        $this->assertSame('0.00', SupplierScore::compute(null, null, '35.00', null, null)['components']['returns']);
    }
}
