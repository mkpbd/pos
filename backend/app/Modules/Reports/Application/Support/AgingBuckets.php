<?php

namespace App\Modules\Reports\Application\Support;

use App\Modules\Reports\Domain\Aging;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;

/**
 * Builds aging rows from aggregate queries: debits are summed per party and age bucket in SQL
 * (a CASE over the document's organization-local date), credits per party; the pure Aging
 * allocation then settles the oldest buckets first.
 */
final class AgingBuckets
{
    /** @var array<string, array<string, string>> party => bucket => amount */
    private array $debits = [];

    /** @var array<string, string> party => amount */
    private array $credits = [];

    public function __construct(private readonly string $today) {}

    /**
     * CASE expression naming the bucket of a 'YYYY-MM-DD' date expression.
     */
    public function bucketSql(string $dateExpression): string
    {
        $today = CarbonImmutable::parse($this->today);
        $cases = '';
        foreach ([30 => 'days_0_30', 60 => 'days_31_60', 90 => 'days_61_90'] as $days => $bucket) {
            $cases .= " WHEN {$dateExpression} >= '".$today->subDays($days)->toDateString()."' THEN '{$bucket}'";
        }

        return "CASE{$cases} ELSE 'days_over_90' END";
    }

    /**
     * Adds a debit query: it must select `party` and `amount`, grouped by party and the bucket
     * expression aliased `bucket`.
     */
    public function addDebits(Builder $query): self
    {
        foreach ($query->get() as $row) {
            $party = (string) $row->party;
            $bucket = (string) $row->bucket;
            $this->debits[$party][$bucket] = Decimal::add($this->debits[$party][$bucket] ?? '0', Sql::plain($row->amount), 6);
        }

        return $this;
    }

    /**
     * Adds a credit query: it must select `party` and `amount`, grouped by party.
     */
    public function addCredits(Builder $query): self
    {
        foreach ($query->get() as $row) {
            $party = (string) $row->party;
            $this->credits[$party] = Decimal::add($this->credits[$party] ?? '0', Sql::plain($row->amount), 6);
        }

        return $this;
    }

    public function addDebit(string $party, string $bucket, string $amount): self
    {
        $this->debits[$party][$bucket] = Decimal::add($this->debits[$party][$bucket] ?? '0', $amount, 6);

        return $this;
    }

    public function addCredit(string $party, string $amount): self
    {
        $this->credits[$party] = Decimal::add($this->credits[$party] ?? '0', $amount, 6);

        return $this;
    }

    /**
     * @return array<string, array{outstanding: string, days_0_30: string, days_31_60: string, days_61_90: string, days_over_90: string}>
     */
    public function results(): array
    {
        $parties = array_unique([...array_keys($this->debits), ...array_keys($this->credits)]);
        $results = [];
        foreach ($parties as $party) {
            $results[(string) $party] = Aging::allocate(
                array_map(fn (string $v) => Decimal::round($v, 2), $this->debits[$party] ?? []),
                Decimal::round($this->credits[$party] ?? '0', 2),
            );
        }

        return $results;
    }
}
