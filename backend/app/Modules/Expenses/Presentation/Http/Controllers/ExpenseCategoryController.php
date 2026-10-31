<?php

namespace App\Modules\Expenses\Presentation\Http\Controllers;

use App\Modules\Expenses\Domain\EntryType;
use App\Modules\Expenses\Infrastructure\Models\ExpenseCategory;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Shared\Infrastructure\Persistence\ReferentialIntegrity;
use App\Modules\Shared\Infrastructure\Validation\TenantUnique;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Expense and income categories (names unique per type).
 */
class ExpenseCategoryController
{
    public function __construct(private readonly AuditTrail $audit) {}

    /**
     * Categories
     *
     * `type` narrows to expense or income categories.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate(['type' => ['sometimes', Rule::enum(EntryType::class)]]);

        return ApiResponse::success(ExpenseCategory::query()
            ->when($request->query('type'), fn ($q, string $v) => $q->where('type', $v))
            ->orderBy('type')->orderBy('name')->get()
            ->map(fn (ExpenseCategory $c) => $this->present($c))->all());
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', Rule::enum(EntryType::class)],
            'name' => ['required', 'string', 'max:100', (new TenantUnique('expense_categories', 'name'))->where('type', $request->input('type'))],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        return ApiResponse::created($this->present($this->save(new ExpenseCategory, $data)));
    }

    public function update(Request $request, ExpenseCategory $expenseCategory): JsonResponse
    {
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:100', (new TenantUnique('expense_categories', 'name', $expenseCategory->id))->where('type', $expenseCategory->type->value)],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        return ApiResponse::success($this->present($this->save($expenseCategory, $data)));
    }

    /**
     * Delete a category
     *
     * Only unused categories (422 `IN_USE`; deactivate those instead).
     */
    public function destroy(ExpenseCategory $expenseCategory): JsonResponse
    {
        DB::transaction(function () use ($expenseCategory) {
            ReferentialIntegrity::deleteOrFail($expenseCategory, 'category');
            $this->audit->record('expense_category.deleted', $expenseCategory, old: $expenseCategory->only(['type', 'name']));
        });

        return ApiResponse::noContent();
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function save(ExpenseCategory $category, array $attributes): ExpenseCategory
    {
        return DB::transaction(function () use ($category, $attributes) {
            $creating = ! $category->exists;
            $before = $creating ? [] : $category->only(['name', 'is_active']);
            if (isset($attributes['name'])) {
                $attributes['name'] = trim($attributes['name']);
            }
            $category->fill($attributes)->save();
            [$old, $new] = Changes::between($before, $category->only(['name', 'is_active']));
            if ($creating || $new !== []) {
                $this->audit->record($creating ? 'expense_category.created' : 'expense_category.updated', $category, $old, $new);
            }

            return $category;
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function present(ExpenseCategory $category): array
    {
        return ['id' => $category->id, 'type' => $category->type->value, 'name' => $category->name, 'is_active' => $category->is_active];
    }
}
