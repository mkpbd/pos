<?php

namespace App\Modules\Purchasing\Domain;

use App\Modules\Shared\Domain\ValueObjects\Money;

/**
 * Server-side totals of a purchase document. Unit costs are tax-exclusive (as on supplier
 * invoices); each line is rounded once: subtotal = qty × cost, tax = subtotal × rate %.
 * Document totals are sums of the rounded lines, so they always match the printed lines.
 */
final class PurchaseTotals
{
    /**
     * @param  list<array{quantity: string, unit_cost: string, tax_rate: string}>  $lines
     * @return array{lines: list<array{line_subtotal: string, line_tax: string, line_total: string}>, subtotal: string, tax_total: string, total: string}
     */
    public static function calculate(array $lines, string $currency): array
    {
        $subtotal = Money::zero($currency);
        $tax = Money::zero($currency);
        $computed = [];

        foreach ($lines as $line) {
            $lineSubtotal = Money::ofProduct($line['quantity'], $line['unit_cost'], $currency);
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
