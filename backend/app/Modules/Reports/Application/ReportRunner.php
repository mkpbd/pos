<?php

namespace App\Modules\Reports\Application;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Organizations\Application\Support\OrganizationDate;
use App\Modules\Reports\Application\Contracts\Report;
use App\Modules\Reports\Application\Support\Sql;
use App\Modules\Reports\Domain\ColumnType;
use App\Modules\Reports\Domain\ReportColumn;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Auth\Access\Authorizable;
use Illuminate\Database\Query\Builder;
use Illuminate\Validation\ValidationException;

/**
 * Runs one report for one user: resolves and checks the parameters, builds the scoped
 * context, runs the report's query, removes cost-sensitive columns the user may not see,
 * sorts (whitelisted columns only) and pages. Exports reuse prepare() + ordered rows.
 */
final class ReportRunner
{
    public const DEFAULT_PER_PAGE = 50;

    public const MAX_PER_PAGE = 500;

    /** Key in ReportResult::$sorts of the expression that makes a query order unique. */
    public const TIEBREAK = '__tiebreak';

    public function __construct(
        private readonly ParameterResolver $resolver,
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
        private readonly OrganizationDate $dates,
    ) {}

    /**
     * The scoped context of a run (parameters validated, branches resolved) — of a report, or
     * of any definition with the same parameter kinds (the dashboard).
     *
     * @param  array<string, mixed>  $input
     */
    public function context(Report|ReportDefinition $report, array $input, TenantUser&Authorizable $user, ?CarbonImmutable $now = null): ReportContext
    {
        $organizationId = $this->tenant->requireOrganization();
        $definition = $report instanceof Report ? $report->definition() : $report;
        $resolved = $this->resolver->resolve($definition, $input, $user, $organizationId);
        $timezone = $this->dates->timezone();
        $now ??= CarbonImmutable::now();
        $at = isset($resolved['params']['date_from']) ? CarbonImmutable::createFromFormat('!Y-m-d', $resolved['params']['date_from'], $timezone) : $now;

        return new ReportContext(
            organizationId: $organizationId,
            user: $user,
            branchIds: $resolved['branch_ids'],
            params: $resolved['params'],
            timezone: $timezone,
            currency: (string) ($this->organizations->summary($organizationId)['base_currency'] ?? config('pos.default_currency', 'BDT')),
            canViewCost: $user->can('products.view_cost'),
            sql: Sql::for($timezone, $at ?: $now),
            now: $now,
            categoryIds: $resolved['category_ids'],
        );
    }

    /**
     * Runs the report and returns the API payload: `data` (the page of rows) and `meta`
     * (pagination, totals, resolved params, generated_at, columns, omitted_columns).
     *
     * @param  array<string, mixed>  $input  query parameters (incl. page, per_page, sort)
     * @return array{data: list<array<string, mixed>>, meta: array<string, mixed>}
     */
    public function run(Report $report, array $input, TenantUser&Authorizable $user): array
    {
        $context = $this->context($report, $input, $user);
        $definition = $report->definition();
        $result = $report->run($context);
        [$sortKey, $descending] = $this->sort($definition, $input, $context->canViewCost);
        $perPage = $definition->paginated ? max(1, min(self::MAX_PER_PAGE, (int) ($input['per_page'] ?? self::DEFAULT_PER_PAGE))) : null;
        $page = max(1, (int) ($input['page'] ?? 1));
        $hidden = $context->canViewCost ? [] : $definition->costSensitiveKeys();

        if ($result->isQuery()) {
            $query = $this->orderedQuery($result, $sortKey, $descending);
            $total = (clone $result->query)->getCountForPagination();
            $perPage ??= max(1, $total);
            $items = ($result->present)(collect($query->forPage($page, $perPage)->get()->all()));
        } else {
            $rows = $this->ordered($definition, $result, $sortKey, $descending);
            $total = count($rows);
            $perPage ??= max(1, $total);
            $items = array_slice($rows, ($page - 1) * $perPage, $perPage);
        }

        return [
            'data' => array_map(fn (array $row) => self::strip($row, $hidden), $items),
            'meta' => [
                'report' => $definition->key,
                'pagination' => [
                    'current_page' => $page,
                    'per_page' => $perPage,
                    'total' => $total,
                    'last_page' => max(1, (int) ceil($total / max(1, $perPage))),
                ],
                'totals' => $result->totals === null ? null : self::strip($result->totals, $hidden),
                'params' => $this->presentParams($context),
                'sort' => $sortKey === null ? null : ($descending ? '-' : '').$sortKey,
                'generated_at' => $context->now->setTimezone($context->timezone)->toIso8601String(),
                'columns' => array_map(fn (ReportColumn $c) => $c->toArray(), $this->columns($definition, $result, $context->canViewCost)),
                'omitted_columns' => $hidden,
            ] + self::strip($result->meta, $hidden),
        ];
    }

    /**
     * A query result's query with the requested order (and the report's tie-breaker).
     */
    public function orderedQuery(ReportResult $result, ?string $sortKey, bool $descending): Builder
    {
        $query = clone $result->query;
        $direction = $descending ? ' DESC' : ' ASC';
        if ($sortKey !== null) {
            $query->orderByRaw($result->sorts[$sortKey].$direction);
        }
        if (isset($result->sorts[self::TIEBREAK])) {
            $query->orderByRaw($result->sorts[self::TIEBREAK].$direction);
        }

        return $query;
    }

    /**
     * A rows result's rows in the requested order (the report's own order without a sort).
     *
     * @return list<array<string, mixed>>
     */
    public function ordered(ReportDefinition $definition, ReportResult $result, ?string $sortKey, bool $descending): array
    {
        return $sortKey === null ? ($result->rows ?? []) : $this->sortRows($definition, $result->rows ?? [], $sortKey, $descending);
    }

    /**
     * Columns returned to this user for this run, with run-specific labels.
     *
     * @return list<ReportColumn>
     */
    public function columns(ReportDefinition $definition, ReportResult $result, bool $canViewCost): array
    {
        $columns = [];
        foreach ($definition->columns as $column) {
            if ($column->costSensitive && ! $canViewCost) {
                continue;
            }
            $columns[] = isset($result->labels[$column->key]) ? $column->withLabel($result->labels[$column->key]) : $column;
        }

        return $columns;
    }

    /**
     * The validated sort: a sortable column the user can see; default from the definition.
     *
     * Statements (no default sort) keep their own line order: [null, false].
     *
     * @param  array<string, mixed>  $input
     * @return array{0: ?string, 1: bool}
     */
    public function sort(ReportDefinition $definition, array $input, bool $canViewCost): array
    {
        if ($definition->defaultSort === null) {
            return [null, false]; // statements: a `sort` parameter is ignored
        }
        $sort = is_string($input['sort'] ?? null) && $input['sort'] !== '' ? $input['sort'] : $definition->defaultSort;
        $default = $definition->column(ltrim($definition->defaultSort, '-'));
        if ($sort === $definition->defaultSort && $default !== null && $default->costSensitive && ! $canViewCost) {
            // The default sorts by a column this user does not get: first visible sortable column instead.
            foreach ($definition->columns as $column) {
                if ($column->sortable && ! $column->costSensitive) {
                    return [$column->key, false];
                }
            }
        }
        $key = ltrim($sort, '-');
        $column = $definition->column($key);
        if ($column === null || ! $column->sortable || ($column->costSensitive && ! $canViewCost)) {
            throw ValidationException::withMessages(['sort' => ["Sorting by [{$key}] is not supported."]]);
        }

        return [$key, str_starts_with($sort, '-')];
    }

    /**
     * Sorts aggregated rows by one column (numbers exactly, text case-insensitively; empty
     * values last), keeping the report's own order for ties.
     *
     * @param  list<array<string, mixed>>  $rows
     * @return list<array<string, mixed>>
     */
    public function sortRows(ReportDefinition $definition, array $rows, string $key, bool $descending): array
    {
        $type = $definition->column($key)?->type ?? ColumnType::Text;
        $indexed = [];
        foreach (array_values($rows) as $i => $row) {
            $indexed[] = [$i, $row];
        }
        usort($indexed, function (array $a, array $b) use ($key, $type, $descending) {
            $x = $a[1][$key] ?? null;
            $y = $b[1][$key] ?? null;
            if ($x === null || $x === '' || $y === null || $y === '') {
                $nullX = $x === null || $x === '';
                $nullY = $y === null || $y === '';

                return $nullX === $nullY ? $a[0] <=> $b[0] : ($nullX ? 1 : -1);
            }
            $cmp = $type->isNumeric()
                ? Decimal::compare(Sql::plain($x), Sql::plain($y))
                : strcmp(mb_strtolower((string) $x), mb_strtolower((string) $y));
            if ($descending) {
                $cmp = -$cmp;
            }

            return $cmp !== 0 ? $cmp : $a[0] <=> $b[0];
        });

        return array_map(fn (array $pair) => $pair[1], $indexed);
    }

    /**
     * @return array<string, mixed>
     */
    public function presentParams(ReportContext $context): array
    {
        return $context->params + ['timezone' => $context->timezone, 'currency' => $context->currency];
    }

    /**
     * @param  array<string, mixed>  $row
     * @param  list<string>  $hidden
     * @return array<string, mixed>
     */
    public static function strip(array $row, array $hidden): array
    {
        return $hidden === [] ? $row : array_diff_key($row, array_flip($hidden));
    }
}
