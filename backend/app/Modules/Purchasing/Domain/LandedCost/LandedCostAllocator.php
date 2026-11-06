<?php

namespace App\Modules\Purchasing\Domain\LandedCost;

use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\ValueObjects\Money;
use InvalidArgumentException;

/**
 * SC3: spreads landed cost charges over receipt lines, exactly.
 *
 * Each charge is split on its own with the largest-remainder method (Money::allocate), by the
 * lines' value (line subtotal, before tax) or base quantity, so the parts of every charge add
 * up to the charge to the cent; a line's landed cost is the sum of its parts. When every
 * line is worth 0, a value charge falls back to quantity (there is nothing else to weigh by).
 */
final class LandedCostAllocator
{
    /**
     * @param  list<array{amount: string, allocation: string|AllocationBasis}>  $charges
     * @param  list<array{quantity: string, value: string}>  $lines
     * @return array{lines: list<string>, charges: list<list<string>>, total: string}
     */
    public static function allocate(array $charges, array $lines, string $currency): array
    {
        if ($lines === []) {
            throw new InvalidArgumentException('Charges need at least one line to be allocated over.');
        }

        $perLine = array_fill(0, count($lines), Money::zero($currency));
        $perCharge = [];
        $total = Money::zero($currency);

        foreach ($charges as $charge) {
            $amount = Money::of($charge['amount'], $currency);
            $basis = $charge['allocation'] instanceof AllocationBasis ? $charge['allocation'] : AllocationBasis::from($charge['allocation']);
            $ratios = self::ratios($lines, $basis);
            $parts = $amount->allocate($ratios);

            $perCharge[] = array_map(fn (Money $m) => $m->amount(), $parts);
            foreach ($parts as $i => $part) {
                $perLine[$i] = $perLine[$i]->plus($part);
            }
            $total = $total->plus($amount);
        }

        return [
            'lines' => array_map(fn (Money $m) => $m->amount(), $perLine),
            'charges' => $perCharge,
            'total' => $total->amount(),
        ];
    }

    /**
     * Unit cost the stock enters at: unit cost + landed cost ÷ quantity, 4 dp.
     */
    public static function landedUnitCost(string $unitCost, string $landedCost, string $quantity): string
    {
        return Decimal::round(Decimal::add($unitCost, Decimal::div($landedCost, $quantity, 10), 10), 4);
    }

    /**
     * Splits a line's amount between the quantity still on hand and the rest (sold, used or
     * returned), proportionally and exactly (the two parts add up to the amount).
     *
     * @return array{on_hand: string, consumed: string}
     */
    public static function split(string $amount, string $onHandQuantity, string $receivedQuantity, string $currency): array
    {
        $money = Money::of($amount, $currency);
        $consumedQuantity = Decimal::sub($receivedQuantity, $onHandQuantity, 3);
        if ($money->isZero() || Decimal::compare($receivedQuantity, '0') <= 0) {
            return ['on_hand' => Money::zero($currency)->amount(), 'consumed' => $money->amount()];
        }
        if (Decimal::compare($onHandQuantity, '0') <= 0) {
            return ['on_hand' => Money::zero($currency)->amount(), 'consumed' => $money->amount()];
        }
        if (Decimal::compare($consumedQuantity, '0') <= 0) {
            return ['on_hand' => $money->amount(), 'consumed' => Money::zero($currency)->amount()];
        }
        [$onHand, $consumed] = $money->allocate([$onHandQuantity, $consumedQuantity]);

        return ['on_hand' => $onHand->amount(), 'consumed' => $consumed->amount()];
    }

    /**
     * @param  list<array{quantity: string, value: string}>  $lines
     * @return list<string>
     */
    private static function ratios(array $lines, AllocationBasis $basis): array
    {
        if ($basis === AllocationBasis::Value) {
            $values = array_map(fn (array $l) => Decimal::round($l['value'], 2), $lines);
            if (array_filter($values, fn (string $v) => Decimal::compare($v, '0') > 0) !== []) {
                return $values;
            }
        }

        $quantities = array_map(fn (array $l) => Decimal::round($l['quantity'], 3), $lines);
        if (array_filter($quantities, fn (string $q) => Decimal::compare($q, '0') > 0) === []) {
            throw new InvalidArgumentException('Charges need a line with a quantity to be allocated over.');
        }

        return $quantities;
    }
}
