<?php

namespace App\Modules\Sales\Domain;

use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\ValueObjects\Money;
use InvalidArgumentException;

/**
 * Values returned goods at their share of what the invoice line actually charged (item and
 * invoice discounts and tax included), so a customer gets back exactly what they paid.
 *
 * Partial returns are proportional and rounded to the cent; the return that brings the line
 * back to zero takes the exact remainder, so all returns of a line add up to the line.
 */
final class ReturnShare
{
    /**
     * @param  array{quantity: string, line_total: string, tax_amount: string, cost_total: string}  $line  the invoice line
     * @param  array{quantity: string, line_total: string, tax_amount: string, cost_total: string}  $returned  earlier returns of the line
     * @return array{net_amount: string, tax_amount: string, line_total: string, cost_total: string}
     */
    public static function of(array $line, array $returned, string $quantity, string $currency): array
    {
        $remaining = Decimal::sub($line['quantity'], $returned['quantity'], 3);
        if (Decimal::compare($quantity, '0') <= 0 || Decimal::compare($quantity, $remaining) > 0) {
            throw new InvalidArgumentException("Cannot return {$quantity}; {$remaining} remain on the line.");
        }

        $last = Decimal::compare($quantity, $remaining) === 0;
        $ratio = Decimal::div($quantity, $line['quantity'], 12);
        $share = fn (string $field) => $last
            ? Money::of($line[$field], $currency)->minus(Money::of($returned[$field], $currency))
            : Money::of($line[$field], $currency)->times($ratio);

        $total = $share('line_total');
        $tax = $share('tax_amount');

        return [
            'net_amount' => $total->minus($tax)->amount(),
            'tax_amount' => $tax->amount(),
            'line_total' => $total->amount(),
            'cost_total' => $share('cost_total')->amount(),
        ];
    }
}
