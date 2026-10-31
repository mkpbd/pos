<?php

namespace App\Modules\Expenses\Presentation\Http\Controllers;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Expenses\Application\Actions\RecordExpense;
use App\Modules\Expenses\Application\Actions\VoidExpense;
use App\Modules\Expenses\Domain\EntryType;
use App\Modules\Expenses\Infrastructure\Models\Expense;
use App\Modules\Expenses\Infrastructure\Models\ExpenseCategory;
use App\Modules\Payments\Domain\PaymentMethod;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Expenses and other income: record, list with totals, show, void.
 */
class ExpenseController
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly BranchDirectory $branches,
        private readonly UserDirectory $users,
    ) {}

    /**
     * Expenses / income
     *
     * Filters: `type` (expense|income, default expense), `branch_id`, `expense_category_id`,
     * `method`, `from`/`to` (dates), `voided` (true|false, default false); `search` matches
     * number, party or reference. `meta.totals` sums the filtered entries; `meta.by_category`
     * breaks them down.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'type' => ['sometimes', Rule::enum(EntryType::class)],
            'branch_id' => ['sometimes', 'uuid'],
            'expense_category_id' => ['sometimes', 'uuid'],
            'method' => ['sometimes', Rule::enum(PaymentMethod::class)],
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
            'voided' => ['sometimes', Rule::in(['true', 'false', '1', '0'])],
        ]);
        /** @var TenantUser $user */
        $user = $request->user();
        $accessible = $user->accessibleBranchIds();
        $voided = in_array($request->query('voided'), ['true', '1'], true);

        $query = Expense::query()
            ->where('type', $request->query('type', EntryType::Expense->value))
            ->when($voided, fn (Builder $q) => $q->whereNotNull('voided_at'), fn (Builder $q) => $q->whereNull('voided_at'))
            ->when($accessible !== null, fn (Builder $q) => $q->whereIn('branch_id', $accessible))
            ->when($request->query('branch_id'), fn (Builder $q, string $v) => $q->where('branch_id', $v))
            ->when($request->query('expense_category_id'), fn (Builder $q, string $v) => $q->where('expense_category_id', $v))
            ->when($request->query('method'), fn (Builder $q, string $v) => $q->where('method', $v))
            ->when($request->query('from'), fn (Builder $q, string $v) => $q->where('occurred_on', '>=', $v))
            ->when($request->query('to'), fn (Builder $q, string $v) => $q->where('occurred_on', '<=', $v));

        $byCategory = (clone $query)->groupBy('expense_category_id')->selectRaw('expense_category_id, SUM(amount) as total, COUNT(*) as entries')->get();
        $names = ExpenseCategory::query()->whereKey($byCategory->pluck('expense_category_id'))->pluck('name', 'id');
        $total = $byCategory->reduce(fn (string $sum, $row) => Decimal::add($sum, Decimal::round((string) $row->getAttribute('total'), 2), 2), '0.00');

        $page = ListQuery::paginate($query, $request, sortable: ['occurred_on', 'created_at', 'amount', 'number'], searchable: ['number', 'party', 'reference'], defaultSort: '-occurred_on');
        $present = $this->presenter(collect($page->items()));

        return ApiResponse::paginated($page, fn (Expense $e) => new JsonResource($present($e)), [
            'totals' => ['amount' => $total],
            'by_category' => $byCategory->map(fn ($row) => [
                'id' => $row->getAttribute('expense_category_id'),
                'name' => $names[$row->getAttribute('expense_category_id')] ?? null,
                'total' => Decimal::round((string) $row->getAttribute('total'), 2),
                'entries' => (int) $row->getAttribute('entries'),
            ])->sortByDesc('total')->values()->all(),
        ]);
    }

    public function show(Request $request, Expense $expense): JsonResponse
    {
        /** @var TenantUser $user */
        $user = $request->user();
        if (! $user->canAccessBranch($expense->branch_id)) {
            throw new NotFoundHttpException;
        }

        return ApiResponse::success(($this->presenter(collect([$expense])))($expense));
    }

    /**
     * Record an expense or income
     *
     * `{type, branch_id, expense_category_id, amount, method, occurred_on, reference?, party?, notes?}`.
     * Cash is paid from (or into) the caller's open register session. Requires an `Idempotency-Key`.
     */
    public function store(Request $request, RecordExpense $record): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', Rule::enum(EntryType::class)],
            'branch_id' => ['required', 'uuid'],
            'expense_category_id' => ['required', 'uuid'],
            'amount' => ['required', 'decimal:0,2', 'gt:0', 'max:99999999'],
            'method' => ['required', Rule::enum(PaymentMethod::class)],
            'occurred_on' => ['required', 'date_format:Y-m-d', 'before_or_equal:today'],
            'reference' => ['sometimes', 'nullable', 'string', 'max:100'],
            'party' => ['sometimes', 'nullable', 'string', 'max:150'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ]);
        /** @var TenantUser $user */
        $user = $request->user();
        $expense = $record($user, $data);

        return ApiResponse::created(($this->presenter(collect([$expense])))($expense));
    }

    /**
     * Void an entry
     *
     * `{reason}`. Books the opposite payment (cash back into / out of the caller's drawer).
     */
    public function void(Request $request, Expense $expense, VoidExpense $void): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:255']]);
        /** @var TenantUser $user */
        $user = $request->user();
        $expense = $void($user, $expense, trim($data['reason']));

        return ApiResponse::success(($this->presenter(collect([$expense])))($expense));
    }

    /**
     * @param  Collection<int, Expense>  $expenses
     * @return callable(Expense): array<string, mixed>
     */
    private function presenter(Collection $expenses): callable
    {
        $org = $this->tenant->requireOrganization();
        $categories = ExpenseCategory::query()->whereKey($expenses->pluck('expense_category_id')->unique())->pluck('name', 'id');
        $branches = collect($this->branches->summaries($org, $expenses->pluck('branch_id')->unique()->values()->all()))->keyBy('id');
        $users = $this->users->names($org, $expenses->flatMap(fn (Expense $e) => [$e->created_by, $e->voided_by])->filter()->unique()->values()->all());

        return fn (Expense $e) => [
            'id' => $e->id,
            'type' => $e->type->value,
            'number' => $e->number,
            'branch' => isset($branches[$e->branch_id]) ? ['id' => $e->branch_id, 'name' => $branches[$e->branch_id]['name']] : null,
            'category' => ['id' => $e->expense_category_id, 'name' => $categories[$e->expense_category_id] ?? null],
            'currency' => $e->currency,
            'amount' => $e->amount,
            'method' => $e->method->value,
            'method_label' => $e->method->label(),
            'reference' => $e->reference,
            'party' => $e->party,
            'occurred_on' => $e->occurred_on->toDateString(),
            'notes' => $e->notes,
            'created_by' => $e->created_by === null ? null : ['id' => $e->created_by, 'name' => $users[$e->created_by] ?? null],
            'created_at' => $e->created_at->toIso8601String(),
            'voided_at' => $e->voided_at?->toIso8601String(),
            'voided_by' => $e->voided_by === null ? null : ['id' => $e->voided_by, 'name' => $users[$e->voided_by] ?? null],
            'void_reason' => $e->void_reason,
        ];
    }
}
