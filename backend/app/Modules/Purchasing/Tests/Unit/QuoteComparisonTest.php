<?php

namespace App\Modules\Purchasing\Tests\Unit;

use App\Modules\Purchasing\Domain\Procurement\QuoteComparison;
use PHPUnit\Framework\TestCase;

class QuoteComparisonTest extends TestCase
{
    private function compare(): array
    {
        return QuoteComparison::compare(
            [['id' => 'L1', 'quantity' => '100.000'], ['id' => 'L2', 'quantity' => '10.000'], ['id' => 'L3', 'quantity' => '5.000']],
            [
                ['supplier_id' => 'A', 'status' => 'received', 'valid_until' => '2026-11-30', 'prices' => [
                    'L1' => ['unit_price' => '18.5000', 'quantity_offered' => null, 'lead_time_days' => 5],
                    'L2' => ['unit_price' => '60.0000', 'quantity_offered' => null, 'lead_time_days' => 3],
                    'L3' => ['unit_price' => '9.9900', 'quantity_offered' => null, 'lead_time_days' => null],
                ]],
                ['supplier_id' => 'B', 'status' => 'received', 'valid_until' => '2026-11-01', 'prices' => [
                    'L1' => ['unit_price' => '18.2500', 'quantity_offered' => '60.000', 'lead_time_days' => 2],
                    'L2' => ['unit_price' => '60.0000', 'quantity_offered' => null, 'lead_time_days' => 3],
                ]],
                ['supplier_id' => 'C', 'status' => 'declined', 'valid_until' => null, 'prices' => []],
                ['supplier_id' => 'D', 'status' => 'pending', 'valid_until' => null, 'prices' => []],
            ],
            'BDT',
            '2026-11-06',
        );
    }

    public function test_lowest_price_and_fastest_flags_with_ties(): void
    {
        $lines = $this->compare()['lines'];

        $this->assertSame(['B'], $lines[0]['lowest_price_supplier_ids']);
        $this->assertSame(['B'], $lines[0]['fastest_supplier_ids']);
        $this->assertSame(['A', 'B'], $lines[1]['lowest_price_supplier_ids'], 'ties flag every tied supplier');
        $this->assertSame(['A', 'B'], $lines[1]['fastest_supplier_ids']);
        $this->assertSame(['A'], $lines[2]['lowest_price_supplier_ids']);
        $this->assertSame([], $lines[2]['fastest_supplier_ids'], 'no lead time quoted');

        $b = $lines[0]['quotes'][1];
        $this->assertSame('B', $b['supplier_id']);
        $this->assertSame('1825.00', $b['line_total']); // requested 100 × 18.25
        $this->assertTrue($b['partial']);
        $this->assertTrue($b['expired']);
        $this->assertTrue($b['lowest_price']);
        $this->assertFalse($lines[0]['quotes'][0]['lowest_price']);
        $this->assertCount(2, $lines[0]['quotes'], 'declined and pending suppliers have no cells');
    }

    public function test_supplier_totals_and_coverage(): void
    {
        $suppliers = collect($this->compare()['suppliers'])->keyBy('supplier_id');

        $this->assertSame('2499.95', $suppliers['A']['total']); // 1850 + 600 + 49.95
        $this->assertSame(3, $suppliers['A']['lines_quoted']);
        $this->assertSame(100, $suppliers['A']['coverage_percent']);
        $this->assertTrue($suppliers['A']['complete']);
        $this->assertFalse($suppliers['A']['expired']);

        $this->assertSame('2425.00', $suppliers['B']['total']);
        $this->assertSame(66, $suppliers['B']['coverage_percent']);
        $this->assertFalse($suppliers['B']['complete']);
        $this->assertTrue($suppliers['B']['expired']);

        $this->assertSame('0.00', $suppliers['C']['total']);
        $this->assertSame('declined', $suppliers['C']['status']);
        $this->assertSame(0, $suppliers['D']['lines_quoted']);
        $this->assertSame(3, $suppliers['D']['lines_total']);
    }
}
