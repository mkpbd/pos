<?php

namespace App\Modules\AI\Application\Tools;

use App\Modules\AI\Domain\Llm\ToolDefinition;
use App\Modules\Reports\Application\Contracts\Report;
use App\Modules\Reports\Application\ReportRunner;
use App\Modules\Reports\Domain\ReportColumn;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Domain\ReportParam;
use App\Modules\Shared\Application\Contracts\TenantUser;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Auth\Access\Authorizable;

/**
 * One Phase 7 registry report as a tool (natural-language reporting: the model only picks a
 * registered key and fills its typed parameters; it never writes SQL). The schema comes from the
 * definition's params: dates, enums, integers, booleans, the branch and the store — entity
 * filters the model cannot know the ids of (product, category, …) are not offered. The call runs
 * through ReportRunner::run() exactly like the reports page: ParameterResolver types and
 * range-checks the parameters, rejects branches / stores outside the user's scope (the error is
 * returned to the model, nothing runs) and cost-sensitive columns are stripped without
 * products.view_cost.
 *
 * The model receives at most `rowLimit` rows plus the totals; customer contact details are
 * removed and customer names replaced by "Customer #n" (the table shown to the user keeps them).
 */
final class ReportTool implements AiTool
{
    private const OFFERED_ENTITIES = ['branch', 'store'];

    /** Keys never sent to the model (least data). */
    private const PII_KEYS = ['phone', 'email', 'customer_id', 'code'];

    public function __construct(
        private readonly Report $report,
        private readonly ReportRunner $runner,
        private readonly TenantUser&Authorizable $user,
        private readonly int $rowLimit,
    ) {}

    public function key(): string
    {
        return $this->report->definition()->key;
    }

    public function definition(): ToolDefinition
    {
        $definition = $this->report->definition();
        $canViewCost = $this->user->can('products.view_cost');
        $properties = [];
        $required = [];
        foreach ($this->offeredParams($definition) as $param) {
            $properties[$param->name] = self::paramSchema($param);
            if ($param->required) {
                $required[] = $param->name;
            }
        }
        $sortable = $this->sortKeys($definition, $canViewCost);
        if ($sortable !== []) {
            $properties['sort'] = [
                'type' => 'string',
                'enum' => $sortable,
                'description' => 'Sort column; prefix "-" for descending. Default: '.$definition->defaultSort.'.',
            ];
        }

        $columns = array_map(
            fn (ReportColumn $c) => $c->key.' ('.$c->type->value.')',
            array_values(array_filter($definition->columns, fn (ReportColumn $c) => $canViewCost || ! $c->costSensitive)),
        );
        $description = $definition->title.' report. '.$definition->description
            .' Columns: '.implode(', ', $columns).'.'
            .($definition->isTimeBased() ? ' Dates are YYYY-MM-DD organization days; at most '.($definition->granularity === 'day' ? ReportDefinition::MAX_DAILY_DAYS : ReportDefinition::MAX_DAYS).' days.' : ' Shows the current state (no date range).')
            .(! $canViewCost && $definition->costSensitiveKeys() !== [] ? ' Cost, profit and stock value columns are not available to this user.' : '')
            .' Returns at most '.$this->rowLimit.' rows plus totals.';

        return new ToolDefinition($definition->key, $description, Arguments::schema($properties, $required));
    }

    public function run(array $input): ToolOutput
    {
        $definition = $this->report->definition();
        if (! $this->user->can($definition->permission)) {
            throw new AuthorizationException;
        }
        $canViewCost = $this->user->can('products.view_cost');
        $allowed = array_map(fn (ReportParam $p) => $p->name, $this->offeredParams($definition));
        if ($this->sortKeys($definition, $canViewCost) !== []) {
            $allowed[] = 'sort';
        }
        $args = Arguments::only($input, $allowed);
        $query = array_map(fn ($v) => is_bool($v) ? ($v ? '1' : '0') : $v, $args);

        $payload = $this->runner->run($this->report, $query + ['page' => 1, 'per_page' => $this->rowLimit], $this->user);
        $meta = $payload['meta'];
        $params = array_diff_key($meta['params'], ['timezone' => true, 'currency' => true]);
        $total = (int) ($meta['pagination']['total'] ?? count($payload['data']));
        $rows = array_slice($payload['data'], 0, $this->rowLimit);

        return new ToolOutput(
            data: [
                'report' => $definition->key,
                'title' => $definition->title,
                'params' => $meta['params'],
                'sort' => $meta['sort'],
                'columns' => array_map(fn (array $c) => ['key' => $c['key'], 'label' => $c['label'], 'type' => $c['type']], $this->modelColumns($meta['columns'])),
                'rows' => $this->forModel($definition, $rows),
                'row_count' => count($rows),
                'total_rows' => $total,
                'truncated' => $total > count($rows),
                'totals' => $meta['totals'] === null ? null : self::withoutPii($meta['totals']),
                'omitted_columns' => $meta['omitted_columns'],
            ] + array_diff_key($meta, array_flip(['report', 'pagination', 'totals', 'params', 'sort', 'generated_at', 'columns', 'omitted_columns'])),
            params: $args,
            report: [
                'key' => $definition->key,
                'title' => $definition->title,
                'params' => $params,
                'columns' => $meta['columns'],
                'rows' => $rows,
                'totals' => $meta['totals'],
                'total_rows' => $total,
                'omitted_columns' => $meta['omitted_columns'],
                'link' => self::link($definition->key, $params, $args['sort'] ?? null),
            ],
        );
    }

    /**
     * The reports page URL with the same parameters ("Open full report").
     *
     * @param  array<string, mixed>  $params
     */
    public static function link(string $key, array $params, ?string $sort = null): string
    {
        $query = [];
        foreach ($params as $name => $value) {
            if ($value === null || $value === '') {
                continue;
            }
            $query[$name] = is_bool($value) ? ($value ? '1' : '0') : (string) $value;
        }
        if ($sort !== null) {
            $query['sort'] = $sort;
        }

        return '/reports/'.$key.($query === [] ? '' : '?'.http_build_query($query));
    }

    /**
     * @return list<ReportParam>
     */
    private function offeredParams(ReportDefinition $definition): array
    {
        return array_values(array_filter($definition->params, fn (ReportParam $p) => $p->type !== 'entity' || in_array($p->entity, self::OFFERED_ENTITIES, true)));
    }

    /**
     * @return list<string>
     */
    private function sortKeys(ReportDefinition $definition, bool $canViewCost): array
    {
        if ($definition->defaultSort === null) {
            return [];
        }
        $keys = [];
        foreach ($definition->columns as $column) {
            if ($column->sortable && ($canViewCost || ! $column->costSensitive) && ! in_array($column->key, self::PII_KEYS, true)) {
                $keys[] = $column->key;
                $keys[] = '-'.$column->key;
            }
        }

        return $keys;
    }

    /**
     * @return array<string, mixed>
     */
    private static function paramSchema(ReportParam $param): array
    {
        $label = $param->label.($param->default !== null ? ' (default: '.(is_bool($param->default) ? ($param->default ? 'true' : 'false') : $param->default).')' : '');

        return match ($param->type) {
            'date' => ['type' => 'string', 'format' => 'date', 'description' => $label.', YYYY-MM-DD in the organization\'s timezone'],
            'entity' => ['type' => 'string', 'description' => $label.': the id of a '.$param->entity.' from the list in the instructions (omit for all accessible '.$param->entity.'s)'],
            'enum' => ['type' => 'string', 'enum' => $param->optionValues(), 'description' => $label.': '.implode('; ', array_map(fn (array $o) => $o['value'].' = '.$o['label'], $param->options ?? []))],
            'integer' => array_filter(['type' => 'integer', 'minimum' => $param->min, 'maximum' => $param->max, 'description' => $label], fn ($v) => $v !== null),
            'boolean' => ['type' => 'boolean', 'description' => $label],
            default => ['type' => 'string', 'description' => $label],
        };
    }

    /**
     * @param  list<array<string, mixed>>  $columns
     * @return list<array<string, mixed>>
     */
    private function modelColumns(array $columns): array
    {
        return array_values(array_filter($columns, fn (array $c) => ! in_array($c['key'], self::PII_KEYS, true)));
    }

    /**
     * Rows for the model: no contact details or customer ids; customer names → "Customer #n".
     *
     * @param  list<array<string, mixed>>  $rows
     * @return list<array<string, mixed>>
     */
    private function forModel(ReportDefinition $definition, array $rows): array
    {
        $anonymize = $definition->column('customer') !== null;
        $result = [];
        foreach (array_values($rows) as $i => $row) {
            $row = self::withoutPii($row);
            if ($anonymize && array_key_exists('customer', $row)) {
                $row['customer'] = 'Customer #'.($i + 1);
            }
            $result[] = $row;
        }

        return $result;
    }

    /**
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    private static function withoutPii(array $row): array
    {
        return array_diff_key($row, array_flip(self::PII_KEYS));
    }
}
