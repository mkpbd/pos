<?php

namespace App\Modules\Sales\Presentation\Http\Controllers;

use App\Modules\Sales\Application\Actions\CompleteSaleReturn;
use App\Modules\Sales\Application\Actions\RejectSaleReturn;
use App\Modules\Sales\Application\Actions\RequestSaleReturn;
use App\Modules\Sales\Application\Services\ReturnPlanner;
use App\Modules\Sales\Application\Services\SalesContext;
use App\Modules\Sales\Domain\ReturnStatus;
use App\Modules\Sales\Domain\SaleStatus;
use App\Modules\Sales\Infrastructure\Models\ReturnReason;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SaleReturn;
use App\Modules\Sales\Presentation\Http\Support\ReturnPresenter;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Sales returns: request (or, for approvers, complete) a return against an invoice, preview
 * its value and settlement, approve with refunds, reject, list and show.
 */
class SaleReturnController
{
    public function __construct(
        private readonly SalesContext $context,
        private readonly ReturnPresenter $presenter,
    ) {}

    /**
     * Returns
     *
     * Filters: `status`, `branch_id`, `sale_id`, `customer_id`, `from`/`to` (request days in the
     * organization's timezone); `search` matches the return number.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'status' => ['sometimes', Rule::enum(ReturnStatus::class)],
            'branch_id' => ['sometimes', 'uuid'],
            'sale_id' => ['sometimes', 'uuid'],
            'customer_id' => ['sometimes', 'uuid'],
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);
        $timezone = $this->context->organization()['timezone'] ?? config('app.timezone');
        $day = fn (string $date) => Carbon::parse($date, $timezone)->startOfDay()->setTimezone(config('app.timezone'));
        $accessible = $this->user($request)->accessibleBranchIds();

        $query = SaleReturn::query()
            ->when($accessible !== null, fn (Builder $q) => $q->whereIn('branch_id', $accessible))
            ->when($request->query('status'), fn (Builder $q, string $v) => $q->where('status', $v))
            ->when($request->query('branch_id'), fn (Builder $q, string $v) => $q->where('branch_id', $v))
            ->when($request->query('sale_id'), fn (Builder $q, string $v) => $q->where('sale_id', $v))
            ->when($request->query('customer_id'), fn (Builder $q, string $v) => $q->where('customer_id', $v))
            ->when($request->query('from'), fn (Builder $q, string $v) => $q->where('requested_at', '>=', $day($v)))
            ->when($request->query('to'), fn (Builder $q, string $v) => $q->where('requested_at', '<', $day($v)->addDay()));

        $page = ListQuery::paginate($query, $request, sortable: ['requested_at', 'number', 'total'], searchable: ['number'], defaultSort: '-requested_at');
        $header = $this->presenter->headers(collect($page->items()));

        return ApiResponse::paginated($page, fn (SaleReturn $r) => new JsonResource($header($r)));
    }

    public function show(Request $request, SaleReturn $saleReturn): JsonResponse
    {
        if (! $this->user($request)->canAccessBranch($saleReturn->branch_id)) {
            throw new NotFoundHttpException;
        }

        return ApiResponse::success($this->presenter->document($saleReturn));
    }

    /**
     * Preview a return
     *
     * Same body as creating one. Values the lines and shows how the total would be settled
     * now (`credit` against the customer's balance, `refund_due`, and `refundable` per method).
     */
    public function preview(Request $request, ReturnPlanner $planner): JsonResponse
    {
        $data = $this->validated($request);
        $sale = Sale::query()->find($data['sale_id']);
        if ($sale === null || ! $this->user($request)->canAccessBranch($sale->branch_id)) {
            throw ValidationException::withMessages(['sale_id' => ['The selected invoice does not exist.']]);
        }
        if ($sale->status !== SaleStatus::Completed) {
            throw new BusinessRuleViolation('SALE_CANCELLED', "{$sale->number} was cancelled; nothing can be returned.");
        }
        $reason = filled($data['return_reason_id'] ?? null) ? ReturnReason::query()->find($data['return_reason_id']) : null;
        $plan = $planner->lines($sale, $data['lines'], $reason);

        return ApiResponse::success([
            'lines' => array_map(fn (array $l) => [
                'sale_line_id' => $l['sale_line']->id,
                'product_name' => $l['sale_line']->product_name,
                'quantity' => $l['quantity'],
                'restock' => $l['restock'],
                'serials' => $l['serials'] ?? [],
                'net_amount' => $l['net_amount'],
                'tax_amount' => $l['tax_amount'],
                'line_total' => $l['line_total'],
            ], $plan['lines']),
            'subtotal' => $plan['subtotal'],
            'tax_total' => $plan['tax_total'],
            'total' => $plan['total'],
            'settlement' => $planner->settlement($sale, $plan['total']),
            'completes_immediately' => $request->user()->can('returns.approve'),
        ]);
    }

    /**
     * Request a return
     *
     * `{sale_id, return_reason_id?, notes?, lines: [{sale_line_id, quantity, restock?, serials?}], refunds?: [{method, amount, reference?}]}`.
     * Pending until approved; with `returns.approve` it is completed at once and `refunds` must
     * add up to the refund due (`REFUND_MISMATCH`). Requires an `Idempotency-Key`.
     */
    public function store(Request $request, RequestSaleReturn $requestReturn): JsonResponse
    {
        $return = $requestReturn($this->user($request), $this->validated($request));

        return ApiResponse::created($this->presenter->document($return));
    }

    /**
     * Approve a return
     *
     * `{refunds: [{method, amount, reference?}]}` adding up to `settlement.refund_due`.
     */
    public function approve(Request $request, SaleReturn $saleReturn, CompleteSaleReturn $complete): JsonResponse
    {
        $data = $request->validate($this->refundRules());

        return ApiResponse::success($this->presenter->document($complete($this->user($request), $saleReturn, $data['refunds'] ?? [])));
    }

    public function reject(Request $request, SaleReturn $saleReturn, RejectSaleReturn $reject): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:255']]);

        return ApiResponse::success($this->presenter->document($reject($this->user($request), $saleReturn, trim($data['reason']))));
    }

    /**
     * @return array<string, mixed>
     */
    private function validated(Request $request): array
    {
        return $request->validate([
            'sale_id' => ['required', 'uuid'],
            'return_reason_id' => ['sometimes', 'nullable', 'uuid'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'lines' => ['required', 'array', 'min:1', 'max:200'],
            'lines.*.sale_line_id' => ['required', 'uuid'],
            'lines.*.quantity' => ['required', 'decimal:0,3', 'gt:0'],
            'lines.*.restock' => ['sometimes', 'boolean'],
            'lines.*.serials' => ['sometimes', 'nullable', 'array', 'max:1000'],
            'lines.*.serials.*' => ['string', 'max:100'],
            ...$this->refundRules(),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function refundRules(): array
    {
        return [
            'refunds' => ['sometimes', 'array', 'max:10'],
            'refunds.*.method' => ['required', 'string', 'max:20'],
            'refunds.*.amount' => ['required', 'decimal:0,2', 'gt:0'],
            'refunds.*.reference' => ['sometimes', 'nullable', 'string', 'max:100'],
        ];
    }

    private function user(Request $request): TenantUser
    {
        /** @var TenantUser */
        return $request->user();
    }
}
