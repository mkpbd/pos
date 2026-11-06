<?php

namespace App\Modules\Purchasing\Tests\Unit;

use App\Modules\Purchasing\Domain\LandedCost\LandedCostAllocator;
use PHPUnit\Framework\TestCase;

class LandedCostAllocatorTest extends TestCase
{
    private const LINES = [
        ['quantity' => '3', 'value' => '30.00'],
        ['quantity' => '3', 'value' => '60.00'],
        ['quantity' => '3', 'value' => '90.00'],
    ];

    public function test_each_charge_is_split_exactly_with_the_largest_remainder(): void
    {
        $result = LandedCostAllocator::allocate([
            ['amount' => '100.00', 'allocation' => 'value'],
            ['amount' => '1.00', 'allocation' => 'quantity'],
        ], self::LINES, 'BDT');

        // 100 by value 30:60:90 → 16.666…, 33.333…, 50 → the spare cent goes to the largest remainder.
        $this->assertSame(['16.67', '33.33', '50.00'], $result['charges'][0]);
        // 1.00 by quantity 3:3:3 → three-way tie → the first line takes the spare cent.
        $this->assertSame(['0.34', '0.33', '0.33'], $result['charges'][1]);
        $this->assertSame(['17.01', '33.66', '50.33'], $result['lines']);
        $this->assertSame('101.00', $result['total']);
    }

    public function test_value_allocation_falls_back_to_quantity_when_no_line_has_a_value(): void
    {
        $result = LandedCostAllocator::allocate([['amount' => '10.00', 'allocation' => 'value']], [
            ['quantity' => '1', 'value' => '0.00'],
            ['quantity' => '3', 'value' => '0.00'],
        ], 'BDT');

        $this->assertSame(['2.50', '7.50'], $result['lines']);
    }

    public function test_odd_amounts_always_add_up(): void
    {
        $lines = [['quantity' => '7', 'value' => '13.13'], ['quantity' => '11', 'value' => '29.99'], ['quantity' => '0.333', 'value' => '0.01']];
        foreach (['0.01', '0.07', '99.99', '12345.67'] as $amount) {
            foreach (['value', 'quantity'] as $basis) {
                $parts = LandedCostAllocator::allocate([['amount' => $amount, 'allocation' => $basis]], $lines, 'BDT')['lines'];
                $this->assertSame($amount, bcadd(bcadd($parts[0], $parts[1], 2), $parts[2], 2), "{$amount} by {$basis}");
            }
        }
    }

    public function test_landed_unit_cost_and_on_hand_split(): void
    {
        $this->assertSame('15.6700', LandedCostAllocator::landedUnitCost('10.0000', '17.01', '3'));
        $this->assertSame('46.7767', LandedCostAllocator::landedUnitCost('30.0000', '50.33', '3'));

        $this->assertSame(['on_hand' => '3.33', 'consumed' => '6.67'], LandedCostAllocator::split('10.00', '1', '3', 'BDT'));
        $this->assertSame(['on_hand' => '0.00', 'consumed' => '10.00'], LandedCostAllocator::split('10.00', '0', '3', 'BDT'));
        $this->assertSame(['on_hand' => '10.00', 'consumed' => '0.00'], LandedCostAllocator::split('10.00', '3', '3', 'BDT'));
        $this->assertSame(['on_hand' => '30.00', 'consumed' => '20.00'], LandedCostAllocator::split('50.00', '6.000', '10.000', 'BDT'));
    }
}
