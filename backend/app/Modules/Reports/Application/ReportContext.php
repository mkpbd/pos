<?php

namespace App\Modules\Reports\Application;

use App\Modules\Reports\Application\Support\Sql;
use App\Modules\Shared\Application\Contracts\TenantUser;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;

/**
 * Everything a report query needs, already validated and scoped: the organization, the
 * branches the query may read (the user's accessible branches ∩ the `branch_id` filter —
 * never the client's word alone), the resolved parameters, the organization's timezone and
 * the period as UTC instants, the cost permission and the SQL helpers.
 */
final readonly class ReportContext
{
    /**
     * @param  list<string>|null  $branchIds  null = every branch of the organization
     * @param  array<string, mixed>  $params  resolved parameters (defaults applied)
     * @param  list<string>|null  $categoryIds  the category filter and its sub-categories
     */
    public function __construct(
        public string $organizationId,
        public TenantUser $user,
        public ?array $branchIds,
        public array $params,
        public string $timezone,
        public string $currency,
        public bool $canViewCost,
        public Sql $sql,
        public CarbonImmutable $now,
        public ?array $categoryIds = null,
    ) {}

    public function param(string $name, mixed $default = null): mixed
    {
        return $this->params[$name] ?? $default;
    }

    /** First day of the period (Y-m-d, organization timezone). */
    public function from(): string
    {
        return (string) $this->params['date_from'];
    }

    /** Last day of the period, inclusive. */
    public function to(): string
    {
        return (string) $this->params['date_to'];
    }

    /** Day after the last day (exclusive bound for business-date columns). */
    public function toExclusive(): string
    {
        return CarbonImmutable::parse($this->to())->addDay()->toDateString();
    }

    /** Start of the period as a bound instant (local midnight of date_from). */
    public function fromInstant(?string $date = null): string
    {
        return $this->sql->instant(CarbonImmutable::createFromFormat('!Y-m-d', $date ?? $this->from(), $this->timezone));
    }

    /** End of the period as a bound instant (local midnight after date_to, exclusive). */
    public function toInstant(?string $date = null): string
    {
        return $this->sql->instant(CarbonImmutable::createFromFormat('!Y-m-d', $date ?? $this->to(), $this->timezone)->addDay());
    }

    /** Today in the organization's timezone. */
    public function today(): string
    {
        return $this->now->setTimezone($this->timezone)->toDateString();
    }

    public function channel(): string
    {
        return (string) ($this->params['channel'] ?? 'all');
    }

    public function includesPos(): bool
    {
        return $this->channel() !== 'online';
    }

    /** Web orders have no cashier: a cashier filter leaves them out. */
    public function includesOnline(): bool
    {
        return $this->channel() !== 'pos' && ($this->params['cashier_id'] ?? null) === null;
    }

    /**
     * Restricts a query to the branches in scope.
     */
    public function scopeBranches(Builder $query, string $column): Builder
    {
        return $this->branchIds === null ? $query : $query->whereIn($column, $this->branchIds);
    }

    /**
     * A copy with other parameters (e.g. the previous period for comparisons).
     *
     * @param  array<string, mixed>  $params
     */
    public function with(array $params): self
    {
        return new self($this->organizationId, $this->user, $this->branchIds, $params + $this->params, $this->timezone,
            $this->currency, $this->canViewCost, $this->sql, $this->now, $this->categoryIds);
    }
}
