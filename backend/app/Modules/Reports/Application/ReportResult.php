<?php

namespace App\Modules\Reports\Application;

use Closure;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;

/**
 * What a report query returns: either every (aggregated) row — sorted and paged by the runner
 * in PHP, which is fine because the database already grouped them — or, for ledgers that can
 * be long (stock movements), a query the runner sorts and pages in SQL and exports in chunks.
 * Totals cover all rows of the period, not just the page.
 */
final class ReportResult
{
    /**
     * @param  list<array<string, mixed>>|null  $rows
     * @param  (Closure(Collection<int, object>): list<array<string, mixed>>)|null  $present
     * @param  array<string, string>  $sorts  column key => SQL expression (query results)
     * @param  array<string, mixed>|null  $totals
     * @param  array<string, string>  $labels  column key => label for this run (e.g. "Category" for the group column)
     * @param  array<string, mixed>  $meta  extra meta (e.g. P&L previous period, stock opening/closing)
     */
    private function __construct(
        public readonly ?array $rows,
        public readonly ?Builder $query,
        public readonly ?Closure $present,
        public readonly array $sorts,
        public readonly ?array $totals,
        public readonly array $labels,
        public readonly array $meta,
    ) {}

    /**
     * @param  list<array<string, mixed>>  $rows
     * @param  array<string, mixed>|null  $totals
     * @param  array<string, string>  $labels
     * @param  array<string, mixed>  $meta
     */
    public static function rows(array $rows, ?array $totals = null, array $labels = [], array $meta = []): self
    {
        return new self(array_values($rows), null, null, [], $totals, $labels, $meta);
    }

    /**
     * @param  Closure(Collection<int, object>): list<array<string, mixed>>  $present
     * @param  array<string, string>  $sorts
     * @param  array<string, mixed>|null  $totals
     * @param  array<string, string>  $labels
     * @param  array<string, mixed>  $meta
     */
    public static function query(Builder $query, Closure $present, array $sorts, ?array $totals = null, array $labels = [], array $meta = []): self
    {
        return new self(null, $query, $present, $sorts, $totals, $labels, $meta);
    }

    public function isQuery(): bool
    {
        return $this->query !== null;
    }
}
