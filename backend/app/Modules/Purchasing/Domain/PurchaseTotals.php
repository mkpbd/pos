<?php

namespace App\Modules\Purchasing\Domain;

use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\ValueObjects\Money;

/**
 * Server-side totals of a purchase document. Unit costs are tax-exclusive (as on supplier
 * invoices); each line is rounded once: subtotal = qty × cost × (100 − discount %) ÷ 100
 * (ST2a: line discount, default 0), tax = subtotal × rate %. Document totals are sums of
 * the rounded lines, so they always match the printed lines.
 */
final class PurchaseTotals
{
    /**
     * @param  list<array{quantity: string, unit_cost: string, tax_rate: string, discount_percent?: ?string}>  $lines
     * @return array{lines: list<array{line_subtotal: string, line_tax: string, line_total: string}>, subtotal: string, tax_total: string, total: string}
     */
    public static function calculate(array $lines, string $currency): array
    {
        $subtotal = Money::zero($currency);
        $tax = Money::zero($currency);
        $computed = [];

        foreach ($lines as $line) {
            // The discounted unit cost is exact (cost 4 dp × percentage 4 dp ÷ 100), so the line is rounded once.
            $discount = (string) ($line['discount_percent'] ?? '0');
            $unitCost = Decimal::isZero($discount)
                ? (string) $line['unit_cost']
                : Decimal::div(Decimal::mul((string) $line['unit_cost'], Decimal::sub('100', $discount, 4), 10), '100', 12);
            $lineSubtotal = Money::ofProduct((string) $line['quantity'], $unitCost, $currency);
            $lineTax = $lineSubtotal->percent($line['tax_rate']);
            $computed[] = [
                'line_subtotal' => $lineSubtotal->amount(),
                'line_tax' => $lineTax->amount(),
                'line_total' => $lineSubtotal->plus($lineTax)->amount(),
            ];
            $subtotal = $subtotal->plus($lineSubtotal);
            $tax = $tax->plus($lineTax);
        }

        return [
            'lines' => $computed,
            'subtotal' => $subtotal->amount(),
            'tax_total' => $tax->amount(),
            'total' => $subtotal->plus($tax)->amount(),
        ];
    }
}
