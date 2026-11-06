<?php

namespace App\Modules\Reports\Domain;

/**
 * A whitelisted report: what it is, who may run it, its typed parameters, its columns, the
 * default sort and whether it has a totals row. `GET /reports` lists these; the AI's natural
 * language reporting (Phase 8) maps questions onto them and never writes SQL.
 *
 * `granularity` 'day' limits time ranges to 366 days (rows per day); every other time-based
 * report (including group_by=month) allows five years. A report whose `group_by` parameter is
 * 'day' is treated as daily too.
 */
final readonly class ReportDefinition
{
    public const MAX_DAILY_DAYS = 366;

    public const MAX_DAYS = 1827; // five years

    /**
     * @param  list<ReportParam>  $params
     * @param  list<ReportColumn>  $columns
     */
    public function __construct(
        public string $key,
        public string $title,
        public string $description,
        public ReportGroup $group,
        public string $permission,
        public array $params,
        public array $columns,
        public ?string $defaultSort,
        public bool $totals = true,
        public bool $paginated = true,
        public ?string $granularity = null,
    ) {}

    public function isFinancial(): bool
    {
        return $this->permission === 'reports.financial';
    }

    public function isTimeBased(): bool
    {
        return $this->param('date_from') !== null;
    }

    public function param(string $name): ?ReportParam
    {
        foreach ($this->params as $param) {
            if ($param->name === $name) {
                return $param;
            }
        }

        return null;
    }

    public function column(string $key): ?ReportColumn
    {
        foreach ($this->columns as $column) {
            if ($column->key === $key) {
                return $column;
            }
        }

        return null;
    }

    /**
     * @return list<string>
     */
    public function costSensitiveKeys(): array
    {
        return array_values(array_map(fn (ReportColumn $c) => $c->key, array_filter($this->columns, fn (ReportColumn $c) => $c->costSensitive)));
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(bool $canViewCost): array
    {
        return [
            'key' => $this->key,
            'title' => $this->title,
            'description' => $this->description,
            'group' => $this->group->value,
            'group_label' => $this->group->label(),
            'permission' => $this->permission,
            'financial' => $this->isFinancial(),
            'time_based' => $this->isTimeBased(),
            'granularity' => $this->granularity,
            'max_range_days' => $this->isTimeBased() ? ($this->granularity === 'day' ? self::MAX_DAILY_DAYS : self::MAX_DAYS) : null,
            'params' => array_map(fn (ReportParam $p) => $p->toArray(), $this->params),
            'columns' => array_map(fn (ReportColumn $c) => $c->toArray(), $this->columns),
            'default_sort' => $this->defaultSort,
            'totals' => $this->totals,
            'paginated' => $this->paginated,
            'omitted_columns' => $canViewCost ? [] : $this->costSensitiveKeys(),
        ];
    }
}
