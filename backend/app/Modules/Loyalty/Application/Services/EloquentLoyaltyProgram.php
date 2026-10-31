<?php

namespace App\Modules\Loyalty\Application\Services;

use App\Modules\Loyalty\Domain\PointsRule;
use App\Modules\Loyalty\Infrastructure\Models\LoyaltySettings;
use App\Modules\Loyalty\Infrastructure\Models\LoyaltyTransaction;
use App\Modules\Sales\Application\Contracts\LoyaltyProgram;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * The organization's loyalty program as Sales sees it. Earning and redeeming follow the
 * current settings (only while enabled); reversals always follow what was booked on the sale,
 * whatever the settings are now.
 */
class EloquentLoyaltyProgram implements LoyaltyProgram
{
    public function __construct(private readonly PointsLedger $ledger) {}

    public function redeem(string $customerId, string $amount, string $saleId, string $saleNumber): void
    {
        $settings = LoyaltySettings::query()->first();
        if ($settings === null || ! $settings->is_enabled) {
            throw new BusinessRuleViolation('LOYALTY_NOT_AVAILABLE', 'The loyalty program is not active; points cannot be redeemed.');
        }
        $points = PointsRule::forAmount($amount, $settings->point_value);
        if ($points === null) {
            throw new BusinessRuleViolation('LOYALTY_AMOUNT_INVALID', "Points are redeemed in whole points worth {$settings->point_value} each.", ['point_value' => $settings->point_value]);
        }
        if ($points < $settings->min_redeem_points) {
            throw new BusinessRuleViolation('LOYALTY_AMOUNT_INVALID', "Redeem at least {$settings->min_redeem_points} points at a time.", ['min_redeem_points' => $settings->min_redeem_points]);
        }

        $transaction = $this->ledger->post($customerId, -$points, [
            'type' => 'redeem', 'source_type' => 'sale', 'source_id' => $saleId, 'source_number' => $saleNumber, 'sale_id' => $saleId, 'value' => Decimal::round($amount, 2),
        ]);
        if ($transaction->balance_after < 0) {
            $available = $transaction->balance_after + $points;
            throw new BusinessRuleViolation('INSUFFICIENT_POINTS', "The customer has {$available} points; {$points} are needed.", ['available' => $available, 'required' => $points]);
        }
    }

    public function award(string $customerId, string $basis, string $saleId, string $saleNumber): void
    {
        $settings = LoyaltySettings::query()->first();
        if ($settings === null || ! $settings->is_enabled) {
            return;
        }
        $points = PointsRule::earned($basis, $settings->spend_amount, $settings->points_per_spend);
        if ($points > 0) {
            $this->ledger->post($customerId, $points, ['type' => 'earn', 'source_type' => 'sale', 'source_id' => $saleId, 'source_number' => $saleNumber, 'sale_id' => $saleId]);
        }
    }

    public function reverseSale(string $customerId, string $saleId, string $saleNumber): void
    {
        $totals = $this->totals($saleId);
        $source = ['source_type' => 'sale_cancellation', 'source_id' => $saleId, 'source_number' => $saleNumber, 'sale_id' => $saleId];

        $earned = $totals['earn'] + $totals['earn_reversal']; // reversals are negative
        if ($earned > 0) {
            $this->ledger->post($customerId, -$earned, ['type' => 'earn_reversal'] + $source);
        }
        $spent = -($totals['redeem'] + $totals['redeem_reversal'] + $totals['refund']);
        if ($spent > 0) {
            $this->ledger->post($customerId, $spent, ['type' => 'redeem_reversal', 'value' => $this->valueOf($saleId, $spent)] + $source);
        }
    }

    public function reverseReturn(string $customerId, string $saleId, string $returnId, string $returnNumber, string $returnedShare, string $refundedAmount): void
    {
        $totals = $this->totals($saleId);
        $source = ['source_type' => 'sale_return', 'source_id' => $returnId, 'source_number' => $returnNumber, 'sale_id' => $saleId];

        $share = Decimal::compare($returnedShare, '1') > 0 ? '1' : $returnedShare;
        $due = PointsRule::share($totals['earn'], $share) + $totals['earn_reversal'];
        if ($due > 0) {
            $this->ledger->post($customerId, -$due, ['type' => 'earn_reversal'] + $source);
        }

        if (Decimal::compare($refundedAmount, '0') > 0) {
            // Refunded at the rate the points were redeemed at, not today's.
            [$points, $value] = $this->redemption($saleId);
            $back = Decimal::isZero($value) ? 0 : (int) Decimal::round(Decimal::div(Decimal::mul($refundedAmount, (string) $points, 6), $value, 6), 0);
            if ($back > 0) {
                $this->ledger->post($customerId, $back, ['type' => 'refund', 'value' => Decimal::round($refundedAmount, 2)] + $source);
            }
        }
    }

    /**
     * Points spent on the sale and the money value they paid.
     *
     * @return array{0: int, 1: string}
     */
    private function redemption(string $saleId): array
    {
        $rows = LoyaltyTransaction::query()->where('sale_id', $saleId)->where('type', 'redeem')->get();

        return [-(int) $rows->sum('points'), $rows->reduce(fn (string $sum, LoyaltyTransaction $t) => Decimal::add($sum, (string) $t->value, 2), '0.00')];
    }

    /**
     * Points booked against a sale, per transaction type (signed).
     *
     * @return array{earn: int, earn_reversal: int, redeem: int, redeem_reversal: int, refund: int}
     */
    private function totals(string $saleId): array
    {
        $sums = LoyaltyTransaction::query()->where('sale_id', $saleId)->groupBy('type')->selectRaw('type, SUM(points) as points')->pluck('points', 'type');

        return array_map(fn (string $type) => (int) ($sums[$type] ?? 0), ['earn' => 'earn', 'earn_reversal' => 'earn_reversal', 'redeem' => 'redeem', 'redeem_reversal' => 'redeem_reversal', 'refund' => 'refund']);
    }

    private function valueOf(string $saleId, int $points): ?string
    {
        [$redeemed, $value] = $this->redemption($saleId);

        return $redeemed <= 0 ? null : Decimal::div(Decimal::mul($value, (string) $points, 6), (string) $redeemed, 2);
    }
}
