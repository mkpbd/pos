<?php

namespace App\Modules\Sales\Tests\Unit;

use App\Modules\Sales\Domain\ReturnShare;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class ReturnShareTest extends TestCase
{
    private const LINE = ['quantity' => '3.000', 'line_total' => '23.00', 'tax_amount' => '3.00', 'cost_total' => '10.00'];

    private const NONE = ['quantity' => '0', 'line_total' => '0', 'tax_amount' => '0', 'cost_total' => '0'];

    public function test_partial_returns_are_proportional_and_the_last_takes_the_remainder(): void
    {
        $first = ReturnShare::of(self::LINE, self::NONE, '1', 'BDT');
        $this->assertSame(['net_amount' => '6.67', 'tax_amount' => '1.00', 'line_total' => '7.67', 'cost_total' => '3.33'], $first);

        $second = ReturnShare::of(self::LINE, ['quantity' => '1', 'line_total' => '7.67', 'tax_amount' => '1.00', 'cost_total' => '3.33'], '1', 'BDT');
        $this->assertSame('7.67', $second['line_total']);

        $last = ReturnShare::of(self::LINE, ['quantity' => '2', 'line_total' => '15.34', 'tax_amount' => '2.00', 'cost_total' => '6.66'], '1', 'BDT');
        $this->assertSame(['net_amount' => '6.66', 'tax_amount' => '1.00', 'line_total' => '7.66', 'cost_total' => '3.34'], $last);
    }

    public function test_a_full_return_gives_back_the_whole_line(): void
    {
        $this->assertSame(['net_amount' => '20.00', 'tax_amount' => '3.00', 'line_total' => '23.00', 'cost_total' => '10.00'], ReturnShare::of(self::LINE, self::NONE, '3', 'BDT'));
    }

    public function test_more_than_remains_is_rejected(): void
    {
        $this->expectException(InvalidArgumentException::class);
        ReturnShare::of(self::LINE, ['quantity' => '2.5', 'line_total' => '0', 'tax_amount' => '0', 'cost_total' => '0'], '1', 'BDT');
    }
}
