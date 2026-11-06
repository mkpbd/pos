<?php

namespace App\Modules\Reports\Domain;

use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * Receivable / payable aging (pure). Documents that raise a balance (invoices, opening
 * balances) are summed per age bucket; everything that lowers it (payments, returns, credits)
 * settles the oldest bucket first (FIFO), because payments are on account, not matched to
 * documents. Buckets by days since the document date: 0–30, 31–60, 61–90, over 90.
 *
 * outstanding = Σ debits − credits (may be negative: credit balance, all buckets zero).
 */
final class Aging
{
    /** Newest first. */
    public const BUCKETS = ['days_0_30', 'days_31_60', 'days_61_90', 'days_over_90'];

    public static function bucket(int $ageDays): string
    {
        return match (true) {
            $ageDays <= 30 => 'days_0_30',
            $ageDays <= 60 => 'days_31_60',
            $ageDays <= 90 => 'days_61_90',
            default => 'days_over_90',
        };
    }

    /**
     * @param  array<string, string>  $debits  bucket => amount raised in that bucket
     * @return array{outstanding: string, days_0_30: string, days_31_60: string, days_61_90: string, days_over_90: string}
     */
    public static function allocate(array $debits, string $credits): array
    {
        $buckets = [];
        $total = '0.00';
        foreach (self::BUCKETS as $bucket) {
            $buckets[$bucket] = Decimal::round($debits[$bucket] ?? '0', 2);
            $total = Decimal::add($total, $buckets[$bucket], 2);
        }

        $remaining = Decimal::round($credits, 2);
        foreach (array_reverse(self::BUCKETS) as $bucket) {
            if (Decimal::compare($remaining, '0') <= 0) {
                break;
            }
            $take = Decimal::min($remaining, Decimal::max($buckets[$bucket], '0'));
            $buckets[$bucket] = Decimal::sub($buckets[$bucket], $take, 2);
            $remaining = Decimal::sub($remaining, $take, 2);
        }
        $outstanding = Decimal::sub($total, Decimal::round($credits, 2), 2);
        if (Decimal::compare($outstanding, '0') < 0) {
            $buckets = array_fill_keys(self::BUCKETS, '0.00');
        }

        return ['outstanding' => $outstanding] + $buckets;
    }
}
