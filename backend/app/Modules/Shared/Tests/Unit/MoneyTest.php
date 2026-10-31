<?php

namespace App\Modules\Shared\Tests\Unit;

use App\Modules\Shared\Domain\ValueObjects\Money;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class MoneyTest extends TestCase
{
    public function test_it_normalises_to_two_decimals(): void
    {
        $this->assertSame('10.00', Money::of('10', 'BDT')->amount());
        $this->assertSame('10.50', Money::of('10.5', 'BDT')->amount());
        $this->assertSame('10.50', Money::of('10.500', 'BDT')->amount());
        $this->assertSame('7.00', Money::of(7, 'BDT')->amount());
    }

    public function test_it_rejects_sub_cent_precision_on_input(): void
    {
        $this->expectException(InvalidArgumentException::class);

        Money::of('10.005', 'BDT');
    }

    /**
     * @return array<string, array{string}>
     */
    public static function invalidAmounts(): array
    {
        return [
            'empty' => [''],
            'exponent' => ['1e3'],
            'letters' => ['ten'],
            'leading dot' => ['.5'],
        ];
    }

    #[DataProvider('invalidAmounts')]
    public function test_it_rejects_non_decimal_input(string $amount): void
    {
        $this->expectException(InvalidArgumentException::class);

        Money::of($amount, 'BDT');
    }

    public function test_it_rejects_invalid_currency(): void
    {
        $this->expectException(InvalidArgumentException::class);

        Money::of('1', 'taka');
    }

    public function test_addition_avoids_float_drift(): void
    {
        $sum = Money::of('0.10', 'BDT')->plus(Money::of('0.20', 'BDT'));

        $this->assertSame('0.30', $sum->amount());
        $this->assertTrue($sum->equals(Money::of('0.3', 'BDT')));
    }

    public function test_subtraction_can_go_negative(): void
    {
        $result = Money::of('5', 'BDT')->minus(Money::of('7.25', 'BDT'));

        $this->assertSame('-2.25', $result->amount());
        $this->assertTrue($result->isNegative());
    }

    public function test_times_rounds_half_away_from_zero(): void
    {
        // 3 x 0.335 = 1.005 -> 1.01
        $this->assertSame('1.01', Money::of('3', 'BDT')->times('0.335')->amount());
        // 1.5 kg x 33.33 = 49.995 -> 50.00
        $this->assertSame('50.00', Money::of('33.33', 'BDT')->times('1.5')->amount());
        $this->assertSame('-1.01', Money::of('-3', 'BDT')->times('0.335')->amount());
    }

    public function test_percent(): void
    {
        $this->assertSame('15.00', Money::of('100', 'BDT')->percent('15')->amount());
        $this->assertSame('1.50', Money::of('9.99', 'BDT')->percent('15')->amount()); // 1.4985
        $this->assertSame('0.75', Money::of('10', 'BDT')->percent('7.5')->amount());
    }

    public function test_currency_mismatch_is_rejected(): void
    {
        $this->expectException(InvalidArgumentException::class);

        Money::of('1', 'BDT')->plus(Money::of('1', 'USD'));
    }

    public function test_allocate_never_loses_cents(): void
    {
        $parts = Money::of('100', 'BDT')->allocate([1, 1, 1]);

        $this->assertSame(['33.34', '33.33', '33.33'], array_map(fn (Money $m) => $m->amount(), $parts));
    }

    public function test_allocate_by_weighted_ratios(): void
    {
        // Spreading a 10.00 invoice discount over lines worth 30.00, 50.00 and 20.00.
        $parts = Money::of('10', 'BDT')->allocate(['30.00', '50.00', '20.00']);

        $this->assertSame(['3.00', '5.00', '2.00'], array_map(fn (Money $m) => $m->amount(), $parts));
    }

    public function test_allocate_gives_remainder_to_largest_fraction(): void
    {
        // 0.05 split 1:2 -> exact 1.666.. / 3.333.. cents -> 2 / 3 cents
        $parts = Money::of('0.05', 'BDT')->allocate([1, 2]);

        $this->assertSame(['0.02', '0.03'], array_map(fn (Money $m) => $m->amount(), $parts));
    }

    public function test_allocate_negative_amount(): void
    {
        $parts = Money::of('-0.10', 'BDT')->allocate([1, 1, 1]);

        $this->assertSame(['-0.04', '-0.03', '-0.03'], array_map(fn (Money $m) => $m->amount(), $parts));
    }

    public function test_allocate_rejects_all_zero_ratios(): void
    {
        $this->expectException(InvalidArgumentException::class);

        Money::of('1', 'BDT')->allocate([0, 0]);
    }

    public function test_comparisons(): void
    {
        $a = Money::of('1.00', 'BDT');
        $b = Money::of('2.00', 'BDT');

        $this->assertTrue($a->lessThan($b));
        $this->assertTrue($b->greaterThan($a));
        $this->assertSame(0, $a->compareTo(Money::of('1', 'BDT')));
        $this->assertTrue(Money::zero('BDT')->isZero());
    }

    public function test_json_serialises_amount_as_string(): void
    {
        $this->assertSame('{"amount":"12.30","currency":"BDT"}', json_encode(Money::of('12.3', 'BDT')));
    }
}
