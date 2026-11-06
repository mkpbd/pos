<?php

namespace App\Modules\Reports\Application;

use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Domain\ReportParam;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Turns raw query parameters into a report's resolved parameters — the same path for the
 * reports page, exports, the dashboard and (Phase 8) the AI's report tools:
 *
 * 1. shape: types from the definition (unknown parameters are ignored), `date_to ≥ date_from`;
 * 2. defaults applied;
 * 3. range: at most 366 days for daily rows (`granularity` day or `group_by=day`), five years
 *    otherwise — else 422 RANGE_TOO_LARGE;
 * 4. entities: every id must belong to the organization; a branch (or a store's branch) the
 *    user may not access is rejected (422) before anything runs;
 * 5. scope: the branches the query may read = the user's accessible branches ∩ `branch_id`.
 */
final class ParameterResolver
{
    /**
     * @param  array<string, mixed>  $input
     * @return array{params: array<string, mixed>, branch_ids: list<string>|null, category_ids: list<string>|null}
     */
    public function resolve(ReportDefinition $definition, array $input, TenantUser $user, string $organizationId): array
    {
        $rules = [];
        foreach ($definition->params as $param) {
            $rules[$param->name] = $this->rules($param);
        }
        if ($definition->param('date_from') !== null && $definition->param('date_to') !== null) {
            $rules['date_to'][] = 'after_or_equal:date_from';
        }
        $values = Validator::make($input, $rules, [
            'date_to.after_or_equal' => 'The end date must be on or after the start date.',
        ])->validate();

        $params = [];
        foreach ($definition->params as $param) {
            $value = $values[$param->name] ?? null;
            if ($value === null || $value === '') {
                $value = $param->default;
            }
            $params[$param->name] = match ($param->type) {
                'integer' => $value === null ? null : (int) $value,
                'boolean' => $value === null ? null : filter_var($value, FILTER_VALIDATE_BOOLEAN),
                default => $value === null ? null : (string) $value,
            };
        }

        $this->checkRange($definition, $params);
        [$branchIds, $categoryIds] = $this->checkEntities($definition, $params, $user, $organizationId);

        return ['params' => $params, 'branch_ids' => $branchIds, 'category_ids' => $categoryIds];
    }

    /**
     * @return list<mixed>
     */
    private function rules(ReportParam $param): array
    {
        $presence = $param->required ? ['required'] : ['sometimes', 'nullable'];

        return [...$presence, ...match ($param->type) {
            'date' => ['date_format:Y-m-d'],
            'entity' => ['uuid'],
            'enum' => [Rule::in($param->optionValues())],
            'integer' => ['integer', 'min:'.($param->min ?? PHP_INT_MIN), 'max:'.($param->max ?? PHP_INT_MAX)],
            'boolean' => [Rule::in(['1', '0', 'true', 'false', 1, 0, true, false])],
            default => ['string'],
        }];
    }

    /**
     * @param  array<string, mixed>  $params
     */
    private function checkRange(ReportDefinition $definition, array $params): void
    {
        if (! $definition->isTimeBased() || $params['date_from'] === null || $params['date_to'] === null) {
            return;
        }
        $days = (int) CarbonImmutable::parse($params['date_from'])->diffInDays(CarbonImmutable::parse($params['date_to'])) + 1;
        $daily = $definition->granularity === 'day' || ($params['group_by'] ?? null) === 'day';
        $max = $daily ? ReportDefinition::MAX_DAILY_DAYS : ReportDefinition::MAX_DAYS;
        if ($days > $max) {
            throw new BusinessRuleViolation(
                'RANGE_TOO_LARGE',
                $daily
                    ? "Daily figures can cover at most {$max} days; this range has {$days}. Shorten the range or group by month."
                    : "Reports can cover at most five years ({$max} days); this range has {$days}.",
                ['max_days' => $max, 'days' => $days],
            );
        }
    }

    /**
     * @param  array<string, mixed>  $params
     * @return array{0: list<string>|null, 1: list<string>|null}
     */
    private function checkEntities(ReportDefinition $definition, array $params, TenantUser $user, string $organizationId): array
    {
        $accessible = $user->accessibleBranchIds();
        $invalid = fn (string $field, string $message) => throw ValidationException::withMessages([$field => [$message]]);
        $owned = fn (string $table, string $id) => DB::table($table)->where('organization_id', $organizationId)->where('id', $id)->exists();

        $branchIds = $accessible;
        if (($branchId = $params['branch_id'] ?? null) !== null) {
            if (! $owned('branches', $branchId)) {
                $invalid('branch_id', 'The selected branch does not exist.');
            }
            if ($accessible !== null && ! in_array($branchId, $accessible, true)) {
                $invalid('branch_id', 'You do not have access to this branch.');
            }
            $branchIds = [$branchId];
        }

        if (($storeId = $params['store_id'] ?? null) !== null) {
            $store = DB::table('stores')->where('organization_id', $organizationId)->where('id', $storeId)->first(['branch_id']);
            if ($store === null) {
                $invalid('store_id', 'The selected store does not exist.');
            }
            if ($branchIds !== null && ! in_array($store->branch_id, $branchIds, true)) {
                $invalid('store_id', 'The selected store is not in a branch you can report on.');
            }
        }

        $tables = ['product' => 'products', 'category' => 'categories', 'brand' => 'brands', 'cashier' => 'users', 'supplier' => 'suppliers', 'customer' => 'customers'];
        foreach ($definition->params as $param) {
            if ($param->type !== 'entity' || ! isset($tables[$param->entity]) || ($params[$param->name] ?? null) === null) {
                continue;
            }
            if (! $owned($tables[$param->entity], $params[$param->name])) {
                $invalid($param->name, "The selected {$param->entity} does not exist.");
            }
        }

        $categoryIds = null;
        if (($categoryId = $params['category_id'] ?? null) !== null) {
            $categoryIds = $this->withDescendants($organizationId, $categoryId);
        }

        return [$branchIds, $categoryIds];
    }

    /**
     * The category and all its sub-categories (the tree is at most four levels deep).
     *
     * @return list<string>
     */
    private function withDescendants(string $organizationId, string $categoryId): array
    {
        $children = DB::table('categories')->where('organization_id', $organizationId)->whereNotNull('parent_id')
            ->get(['id', 'parent_id'])->groupBy('parent_id');
        $ids = [$categoryId];
        for ($i = 0; $i < count($ids); $i++) {
            foreach ($children[$ids[$i]] ?? [] as $child) {
                if (! in_array($child->id, $ids, true)) {
                    $ids[] = $child->id;
                }
            }
        }

        return $ids;
    }
}
