<?php

namespace App\Modules\Sales\Domain;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\ValueObjects\Money;

/**
 * Critical workflows #5 and #6: discount and tax calculation. Pure and deterministic, so
 * the price preview and the checkout always agree to the cent.
 *
 * Per line:
 *   subtotal        = quantity × unit price (rounded once)
 *   item discount   = percent of the subtotal, or a fixed amount
 *   invoice share   = the invoice discount allocated over lines in proportion to their
 *                     amount after item discounts (largest remainder, so shares add up exactly)
 *   amount          = subtotal − item discount − invoice share
 *   tax (exclusive) = amount × rate %                  → line total = amount + tax
 *   tax (inclusive) = amount × rate / (100 + rate)     → line total = amount (tax inside)
 *
 * Every line is rounded to the cent and invoice totals are sums of line values, so a
 * printed invoice always adds up.
 */
final class SaleCalculator
{
    /**
     * @param  list<array{quantity: string, unit_price: string, tax_rate: string, discount: ?Discount}>  $lines
     * @return array{
     *   lines: list<array{line_subtotal: string, discount_amount: string, invoice_discount_share: string, net_amount: string, tax_amount: string, line_total: string}>,
     *   subtotal: string, item_discount_total: string, invoice_discount_total: string, discount_total: string,
     *   net_total: string, tax_total: string, total: string
     * }
     *
     * @throws BusinessRuleViolation DISCOUNT_NOT_ALLOWED when a discount exceeds what it applies to
     */
    public static function calculate(array $lines, ?Discount $invoiceDiscount, TaxMode $taxMode, string $currency): array
    {
        $zero = Money::zero($currency);
        $subtotals = [];
        $itemDiscounts = [];
        $afterItem = [];

        foreach ($lines as $i => $line) {
            $subtotals[$i] = Money::ofProduct($line['quantity'], $line['unit_price'], $currency);
            $itemDiscounts[$i] = $line['discount']?->of($subtotals[$i]) ?? $zero;
            $afterItem[$i] = $subtotals[$i]->minus($itemDiscounts[$i]);
        }

        $base = array_reduce($afterItem, fn (Money $sum, Money $m) => $sum->plus($m), $zero);
        $invoiceTotal = $invoiceDiscount?->of($base) ?? $zero;
        $shares = $invoiceTotal->isZero() || $lines === []
            ? array_fill(0, count($lines), $zero)
            : $invoiceTotal->allocate(array_map(fn (Money $m) => $m->amount(), $afterItem));

        $result = [];
        $totals = ['subtotal' => $zero, 'item' => $zero, 'invoice' => $zero, 'net' => $zero, 'tax' => $zero, 'total' => $zero];

        foreach ($lines as $i => $line) {
            $amount = $afterItem[$i]->minus($shares[$i]);
            $rate = Decimal::round($line['tax_rate'], 4);

            if ($taxMode === TaxMode::Inclusive) {
                $tax = Money::ofProduct(Decimal::div(Decimal::mul($amount->amount(), $rate, 8), Decimal::add('100', $rate, 4), 10), '1', $currency);
                $net = $amount->minus($tax);
                $lineTotal = $amount;
            } else {
                $tax = $amount->percent($rate);
                $net = $amount;
                $lineTotal = $amount->plus($tax);
            }

            $result[] = [
                'line_subtotal' => $subtotals[$i]->amount(),
                'discount_amount' => $itemDiscounts[$i]->amount(),
                'invoice_discount_share' => $shares[$i]->amount(),
                'net_amount' => $net->amount(),
                'tax_amount' => $tax->amount(),
                'line_total' => $lineTotal->amount(),
            ];

            $totals['subtotal'] = $totals['subtotal']->plus($subtotals[$i]);
            $totals['item'] = $totals['item']->plus($itemDiscounts[$i]);
            $totals['invoice'] = $totals['invoice']->plus($shares[$i]);
            $totals['net'] = $totals['net']->plus($net);
            $totals['tax'] = $totals['tax']->plus($tax);
            $totals['total'] = $totals['total']->plus($lineTotal);
        }

        return [
            'lines' => $result,
            'subtotal' => $totals['subtotal']->amount(),
            'item_discount_total' => $totals['item']->amount(),
            'invoice_discount_total' => $totals['invoice']->amount(),
            'discount_total' => $totals['item']->plus($totals['invoice'])->amount(),
            'net_total' => $totals['net']->amount(),
            'tax_total' => $totals['tax']->amount(),
            'total' => $totals['total']->amount(),
        ];
    }
}
