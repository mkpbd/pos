<?php

namespace App\Modules\Sales\Tests\Unit;

use App\Modules\Sales\Domain\Discount;
use App\Modules\Sales\Domain\SaleCalculator;
use App\Modules\Sales\Domain\TaxMode;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Money;
use PHPUnit\Framework\TestCase;

/**
 * Critical workflows #5 (discount calculation) and #6 (tax calculation).
 */
class SaleCalculatorTest extends TestCase
{
    private function line(string $quantity, string $price, string $tax = '0', ?Discount $discount = null): array
    {
        return ['quantity' => $quantity, 'unit_price' => $price, 'tax_rate' => $tax, 'discount' => $discount];
    }

    public function test_tax_exclusive_adds_tax_on_top(): void
    {
        $result = SaleCalculator::calculate([$this->line('2', '100.00', '15')], null, TaxMode::Exclusive, 'BDT');

        $this->assertSame('200.00', $result['subtotal']);
        $this->assertSame('30.00', $result['tax_total']);
        $this->assertSame('230.00', $result['total']);
        $this->assertSame('200.00', $result['net_total']);
    }

    public function test_tax_inclusive_extracts_tax_from_the_price(): void
    {
        $result = SaleCalculator::calculate([$this->line('1', '115.00', '15'), $this->line('1', '100.00', '15')], null, TaxMode::Inclusive, 'BDT');

        $this->assertSame(['15.00', '13.04'], array_column($result['lines'], 'tax_amount'));
        $this->assertSame(['100.00', '86.96'], array_column($result['lines'], 'net_amount'));
        $this->assertSame('215.00', $result['total']);
        $this->assertSame('28.04', $result['tax_total']);
    }

    public function test_item_discount_then_tax_rounds_per_line(): void
    {
        // 3 × 33.33 = 99.99; 10 % = 9.999 → 10.00; 89.99 × 15 % = 13.4985 → 13.50
        $result = SaleCalculator::calculate([$this->line('3', '33.33', '15', Discount::percent('10'))], null, TaxMode::Exclusive, 'BDT');

        $this->assertSame('99.99', $result['lines'][0]['line_subtotal']);
        $this->assertSame('10.00', $result['lines'][0]['discount_amount']);
        $this->assertSame('13.50', $result['lines'][0]['tax_amount']);
        $this->assertSame('103.49', $result['total']);
    }

    public function test_invoice_discount_is_allocated_exactly_over_lines(): void
    {
        $result = SaleCalculator::calculate(
            [$this->line('1', '100.00'), $this->line('1', '50.00'), $this->line('1', '0.00')],
            Discount::amount('10.00'),
            TaxMode::Exclusive,
            'BDT',
        );

        $this->assertSame(['6.67', '3.33', '0.00'], array_column($result['lines'], 'invoice_discount_share'));
        $this->assertSame('10.00', $result['invoice_discount_total']);
        $this->assertSame('140.00', $result['total']);
    }

    public function test_invoice_percent_discount_reduces_the_taxable_amount(): void
    {
        $result = SaleCalculator::calculate([$this->line('1', '200.00', '10', Discount::amount('20.00'))], Discount::percent('5'), TaxMode::Exclusive, 'BDT');

        // 200 − 20 = 180; invoice 5 % = 9.00 → 171.00; tax 10 % = 17.10
        $this->assertSame('29.00', $result['discount_total']);
        $this->assertSame('17.10', $result['tax_total']);
        $this->assertSame('188.10', $result['total']);
    }

    public function test_fractional_quantities_are_multiplied_exactly(): void
    {
        $result = SaleCalculator::calculate([$this->line('1.250', '62.00'), $this->line('0.333', '33.33')], null, TaxMode::Exclusive, 'BDT');

        $this->assertSame(['77.50', '11.10'], array_column($result['lines'], 'line_total'));
        $this->assertSame('88.60', $result['total']);
    }

    public function test_a_fixed_discount_larger_than_the_line_is_refused(): void
    {
        $this->expectException(BusinessRuleViolation::class);

        SaleCalculator::calculate([$this->line('1', '5.00', '0', Discount::amount('6.00'))], null, TaxMode::Exclusive, 'BDT');
    }

    public function test_discount_percentage_is_derived_for_limit_checks(): void
    {
        $this->assertSame('12.5000', Discount::amount('25.00')->percentOf(Money::of('200.00', 'BDT')));
        $this->assertSame('10.0000', Discount::percent('10')->percentOf(Money::of('1.00', 'BDT')));
    }
}
