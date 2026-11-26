<?php

namespace App\Modules\Purchasing\Tests\Unit;

use App\Modules\Purchasing\Domain\PurchaseTotals;
use PHPUnit\Framework\TestCase;

class PurchaseTotalsTest extends TestCase
{
    public function test_lines_are_rounded_once_and_document_totals_are_their_sums(): void
    {
        $totals = PurchaseTotals::calculate([
            ['quantity' => '10', 'unit_cost' => '18.50', 'tax_rate' => '15'],
            ['quantity' => '1.250', 'unit_cost' => '33.3333', 'tax_rate' => '7.5'], // 41.666625 → 41.67; tax 3.125… → 3.13
            ['quantity' => '3', 'unit_cost' => '0.335', 'tax_rate' => '0'],        // 1.005 → 1.01
        ], 'BDT');

        $this->assertSame(['line_subtotal' => '185.00', 'line_tax' => '27.75', 'line_total' => '212.75'], $totals['lines'][0]);
        $this->assertSame(['line_subtotal' => '41.67', 'line_tax' => '3.13', 'line_total' => '44.80'], $totals['lines'][1]);
        $this->assertSame('1.01', $totals['lines'][2]['line_total']);
        $this->assertSame('227.68', $totals['subtotal']);
        $this->assertSame('30.88', $totals['tax_total']);
        $this->assertSame('258.56', $totals['total']);
    }

    public function test_line_discount_is_applied_before_tax_with_one_rounding(): void
    {
        $totals = PurchaseTotals::calculate([
            ['quantity' => '10', 'unit_cost' => '18.50', 'tax_rate' => '15', 'discount_percent' => '5'],   // 175.75; tax 26.3625 → 26.36
            ['quantity' => '1', 'unit_cost' => '0.005', 'tax_rate' => '0', 'discount_percent' => '10'],     // 0.0045 → 0.00 (not 0.01 × 0.9)
            ['quantity' => '2', 'unit_cost' => '10', 'tax_rate' => '0', 'discount_percent' => null],        // no discount
        ], 'BDT');

        $this->assertSame(['line_subtotal' => '175.75', 'line_tax' => '26.36', 'line_total' => '202.11'], $totals['lines'][0]);
        $this->assertSame('0.00', $totals['lines'][1]['line_subtotal']);
        $this->assertSame('20.00', $totals['lines'][2]['line_subtotal']);
        $this->assertSame('195.75', $totals['subtotal']);
        $this->assertSame('222.11', $totals['total']);
    }

    public function test_empty_document(): void
    {
        $this->assertSame('0.00', PurchaseTotals::calculate([], 'BDT')['total']);
    }
}
