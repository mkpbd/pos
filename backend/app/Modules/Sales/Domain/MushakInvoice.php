<?php

namespace App\Modules\Sales\Domain;

use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * VAT1: the Mushak-6.3 (tax invoice) block printed on a till sale or a web order, shaped from
 * the lines' stored snapshots — nothing is recalculated. Value is the stored tax-exclusive
 * amount after discounts (net), VAT and total the stored line tax and total. Supplementary
 * duty is not charged (always 0). The unit price is the stored one, except with tax-inclusive
 * prices, where the VAT inside it is taken out (unit price × 100 / (100 + rate), to the cent)
 * so the column is tax-exclusive like the value.
 */
final class MushakInvoice
{
    /**
     * @param  array{name: string, bin: string, address: ?string}  $seller
     * @param  array{name: string, bin: ?string, address: ?string}  $buyer
     * @param  string  $issuedAt  ISO 8601 in the organization's timezone
     * @param  list<array{description: string, unit: ?string, quantity: string, unit_price: string, net_amount: string, tax_rate: string, tax_amount: string, line_total: string}>  $lines
     * @return array<string, mixed>
     */
    public static function of(array $seller, array $buyer, string $invoiceNumber, string $issuedAt, array $lines, bool $pricesIncludeTax, bool $cancelled): array
    {
        $totals = ['value' => '0.00', 'sd' => '0.00', 'vat' => '0.00', 'total' => '0.00'];
        $rows = [];
        foreach ($lines as $line) {
            $rate = Decimal::round($line['tax_rate'], 2);
            $rows[] = [
                'description' => $line['description'],
                'unit' => $line['unit'],
                'quantity' => $line['quantity'],
                'unit_price' => $pricesIncludeTax
                    ? Decimal::div(Decimal::mul($line['unit_price'], '100', 6), Decimal::add('100', $line['tax_rate'], 4), 2)
                    : $line['unit_price'],
                'value' => $line['net_amount'],
                'sd_rate' => '0.00',
                'sd_amount' => '0.00',
                'vat_rate' => $rate,
                'vat_amount' => $line['tax_amount'],
                'total' => $line['line_total'],
            ];
            $totals['value'] = Decimal::add($totals['value'], $line['net_amount'], 2);
            $totals['vat'] = Decimal::add($totals['vat'], $line['tax_amount'], 2);
            $totals['total'] = Decimal::add($totals['total'], $line['line_total'], 2);
        }

        return [
            'form' => 'Mushak-6.3',
            'seller' => $seller,
            'buyer' => $buyer,
            'invoice_number' => $invoiceNumber,
            'issued_at' => $issuedAt,
            'lines' => $rows,
            'totals' => $totals,
            'prices_include_tax' => $pricesIncludeTax,
            'cancelled' => $cancelled,
        ];
    }

    /**
     * "Product — Variant" (the variant only when there is one).
     */
    public static function description(string $productName, ?string $variantName): string
    {
        return $variantName === null || $variantName === '' ? $productName : "{$productName} — {$variantName}";
    }
}
