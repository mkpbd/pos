<?php

namespace App\Modules\Sales\Domain;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Money;

/**
 * Critical workflow #7: multiple payments. Applies the tendered payments to a sale total:
 * split payments add up, anything short of the total remains due, and only cash can be
 * over-tendered (the excess is change, taken from the last cash payments first).
 */
final class PaymentSettlement
{
    /**
     * @param  list<array{method: PaymentMethod, amount: string, reference?: ?string}>  $tenders
     * @return array{
     *   payments: list<array{method: PaymentMethod, amount: string, tendered: ?string, reference: ?string}>,
     *   paid_total: string, change: string, due: string
     * }
     *
     * @throws BusinessRuleViolation NON_CASH_OVERPAYMENT
     */
    public static function settle(Money $total, array $tenders): array
    {
        $currency = $total->currency;
        $tendered = array_reduce($tenders, fn (Money $sum, array $t) => $sum->plus(Money::of($t['amount'], $currency)), Money::zero($currency));
        $change = $tendered->greaterThan($total) ? $tendered->minus($total) : Money::zero($currency);

        $cash = array_reduce(
            array_filter($tenders, fn (array $t) => $t['method'] === PaymentMethod::Cash),
            fn (Money $sum, array $t) => $sum->plus(Money::of($t['amount'], $currency)),
            Money::zero($currency),
        );
        if ($change->greaterThan($cash)) {
            throw new BusinessRuleViolation('NON_CASH_OVERPAYMENT', 'Card and mobile payments must not exceed the amount due; only cash can be over-tendered.', [
                'total' => $total->amount(),
                'tendered' => $tendered->amount(),
            ]);
        }

        $applied = array_map(fn (array $t) => Money::of($t['amount'], $currency), $tenders);
        $remainingChange = $change;
        for ($i = count($tenders) - 1; $i >= 0 && $remainingChange->isPositive(); $i--) {
            if ($tenders[$i]['method'] !== PaymentMethod::Cash) {
                continue;
            }
            $take = $remainingChange->greaterThan($applied[$i]) ? $applied[$i] : $remainingChange;
            $applied[$i] = $applied[$i]->minus($take);
            $remainingChange = $remainingChange->minus($take);
        }

        $payments = [];
        foreach ($tenders as $i => $t) {
            if ($applied[$i]->isZero()) {
                continue; // a cash tender that only produced change
            }
            $payments[] = [
                'method' => $t['method'],
                'amount' => $applied[$i]->amount(),
                'tendered' => $t['method'] === PaymentMethod::Cash ? Money::of($t['amount'], $currency)->amount() : null,
                'reference' => $t['reference'] ?? null,
            ];
        }

        $paid = $tendered->minus($change);

        return [
            'payments' => $payments,
            'paid_total' => $paid->amount(),
            'change' => $change->amount(),
            'due' => $total->minus($paid)->amount(),
        ];
    }
}
