<?php

namespace App\Modules\Shared\Tests\Unit;

use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\ValueObjects\Money;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class DecimalTest extends TestCase
{
    public function test_arithmetic_is_exact_at_requested_scale(): void
    {
        $this->assertSame('0.300', Decimal::add('0.1', '0.2', 3));
        $this->assertSame('-1.250', Decimal::sub('1', '2.25', 3));
        $this->assertSame('41.6667', Decimal::mul('1.25', '33.33333', 4));
        $this->assertSame('3.3333', Decimal::div('10', '3', 4));
        $this->assertSame('0.67', Decimal::div('2', '3', 2));
    }

    public function test_comparisons_and_predicates(): void
    {
        $this->assertSame(0, Decimal::compare('1.0', '1.000'));
        $this->assertTrue(Decimal::isZero('0.000'));
        $this->assertTrue(Decimal::isNegative('-0.001'));
        $this->assertTrue(Decimal::isWhole('12.000'));
        $this->assertFalse(Decimal::isWhole('12.5'));
        $this->assertSame('-3.500', Decimal::negate('3.5', 3));
    }

    public function test_rejects_floats_formatted_as_exponents_and_division_by_zero(): void
    {
        $this->expectException(InvalidArgumentException::class);
        Decimal::add('1e3', '1', 2);
    }

    public function test_division_by_zero(): void
    {
        $this->expectException(InvalidArgumentException::class);
        Decimal::div('1', '0.000', 2);
    }

    public function test_ceil_floor_min_max(): void
    {
        $this->assertSame('3', Decimal::ceil('2.0001'));
        $this->assertSame('2', Decimal::ceil('2.000'));
        $this->assertSame('-2', Decimal::ceil('-2.5'));
        $this->assertSame('2.51', Decimal::ceil('2.501', 2));
        $this->assertSame('2', Decimal::floor('2.999'));
        $this->assertSame('-3', Decimal::floor('-2.5'));
        $this->assertSame('2.50', Decimal::floor('2.509', 2));
        $this->assertSame('5', Decimal::max('5', '4.9'));
        $this->assertSame('4.9', Decimal::min('5', '4.9'));
    }

    public function test_money_of_product_rounds_once(): void
    {
        // 1.250 kg × 33.3333 = 41.666625 → 41.67
        $this->assertSame('41.67', Money::ofProduct('1.250', '33.3333', 'BDT')->amount());
        $this->assertSame('0.01', Money::ofProduct('0.001', '5', 'BDT')->amount()); // 0.005 → 0.01
    }
}
