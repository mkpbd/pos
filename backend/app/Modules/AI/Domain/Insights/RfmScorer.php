<?php

namespace App\Modules\AI\Domain\Insights;

use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * RFM scoring (pure). Per customer: recency R (days since the last purchase — fewer is better),
 * frequency F (purchases in the window) and monetary M (net sales in the window, a decimal
 * string). Each becomes a quintile score 1–5 by rank among the customers analysed:
 *
 *   sort ascending by "goodness" (R: most days first; F and M: smallest first);
 *   score = ⌊k × 5 ÷ n⌋ + 1, where k is the 0-based position of the first customer with the same
 *   value (ties share a score) and n the number of customers.
 *
 * Segments, first match wins:
 *   New          F = 1 purchase and R ≥ 4
 *   Champions    R ≥ 4, F ≥ 4, M ≥ 4
 *   Loyal        R ≥ 3, F ≥ 3
 *   At risk      R ≤ 2, F ≥ 3
 *   Hibernating  R ≤ 2, F ≤ 2
 *   Potential    everything else (recent, few purchases)
 */
final class RfmScorer
{
    /**
     * @param  list<array{id: string, recency_days: int, frequency: int, monetary: string}>  $customers
     * @return array<string, array{r: int, f: int, m: int, segment: Segment}>
     */
    public static function score(array $customers): array
    {
        if ($customers === []) {
            return [];
        }
        $r = self::quintiles($customers, fn (array $a, array $b) => $b['recency_days'] <=> $a['recency_days']);
        $f = self::quintiles($customers, fn (array $a, array $b) => $a['frequency'] <=> $b['frequency']);
        $m = self::quintiles($customers, fn (array $a, array $b) => Decimal::compare($a['monetary'], $b['monetary']));

        $scores = [];
        foreach ($customers as $c) {
            $scores[$c['id']] = [
                'r' => $r[$c['id']],
                'f' => $f[$c['id']],
                'm' => $m[$c['id']],
                'segment' => self::segment($r[$c['id']], $f[$c['id']], $m[$c['id']], $c['frequency']),
            ];
        }

        return $scores;
    }

    public static function segment(int $r, int $f, int $m, int $purchases): Segment
    {
        return match (true) {
            $purchases === 1 && $r >= 4 => Segment::New,
            $r >= 4 && $f >= 4 && $m >= 4 => Segment::Champions,
            $r >= 3 && $f >= 3 => Segment::Loyal,
            $r <= 2 && $f >= 3 => Segment::AtRisk,
            $r <= 2 && $f <= 2 => Segment::Hibernating,
            default => Segment::Potential,
        };
    }

    /**
     * @param  list<array{id: string, recency_days: int, frequency: int, monetary: string}>  $customers
     * @param  callable(array, array): int  $compare  ascending goodness
     * @return array<string, int>
     */
    private static function quintiles(array $customers, callable $compare): array
    {
        $sorted = $customers;
        usort($sorted, fn (array $a, array $b) => $compare($a, $b) ?: strcmp($a['id'], $b['id']));
        $n = count($sorted);

        $scores = [];
        $groupStart = 0;
        foreach ($sorted as $k => $c) {
            if ($k > 0 && $compare($sorted[$k - 1], $c) !== 0) {
                $groupStart = $k;
            }
            $scores[$c['id']] = min(5, intdiv($groupStart * 5, $n) + 1);
        }

        return $scores;
    }
}
