<?php

namespace App\Modules\Purchasing\Presentation\Http\Controllers;

use App\Modules\Purchasing\Application\Actions\ChangeRequisitionStatus;
use App\Modules\Purchasing\Application\Actions\ConvertRequisition;
use App\Modules\Purchasing\Application\Actions\SaveRequisition;
use App\Modules\Purchasing\Application\Queries\CostEstimates;
use App\Modules\Purchasing\Application\Services\ApprovalRules;
use App\Modules\Purchasing\Domain\Procurement\ApprovalLevel;
use App\Modules\Purchasing\Domain\Procurement\RequisitionStatus;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseRequisition;
use App\Modules\Purchasing\Presentation\Http\Exports\RequisitionsExport;
use App\Modules\Purchasing\Presentation\Http\Requests\ConvertRequisitionRequest;
use App\Modules\Purchasing\Presentation\Http\Requests\SaveRequisitionRequest;
use App\Modules\Purchasing\Presentation\Http\Support\ProcurementPresenter;
use App\Modules\Purchasing\Presentation\Http\Support\PurchasingPresenter;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Infrastructure\Http\Exports\RowSource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Purchase requisitions (SC2). Holders of `purchases.view` (or an approve permission) see every
 * requisition of their branches; holders of only `purchases.request` see their own.
 */
class RequisitionController
{
    private const READERS = ['purchases.view', 'purchases.request', 'purchases.approve', 'purchases.approve_high'];

    public function __construct(
        private readonly ProcurementPresenter $presenter,
        private readonly PurchasingPresenter $purchasing,
        private readonly ApprovalRules $rules,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * List purchase requisitions
     *
     * Filters: `status`, `approval_level`, `store_id`, `requested_by`, `mine=1`; `search` matches
     * the number. Sort: `created_at` (default, newest first), `number`, `estimated_total`,
     * `needed_by`, `submitted_at`.
     */
    public function index(Request $request, ListExporter $exports): Response
    {
        $user = $this->user($request);
        $this->rules->requireAny($user, self::READERS);
        $request->validate([
            'status' => ['sometimes', Rule::enum(RequisitionStatus::class)],
            'approval_level' => ['sometimes', Rule::enum(ApprovalLevel::class)],
            'store_id' => ['sometimes', 'uuid'],
            'requested_by' => ['sometimes', 'uuid'],
            'mine' => ['sometimes', 'boolean'],
        ]);
        $query = PurchaseRequisition::query()
            ->withCount('lines')
            ->when($request->query('status'), fn (Builder $q, string $v) => $q->where('status', $v))
            ->when($request->query('approval_level'), fn (Builder $q, string $v) => $q->where('approval_level', $v))
            ->when($request->query('store_id'), fn (Builder $q, string $v) => $q->where('store_id', $v))
            ->when($request->query('requested_by'), fn (Builder $q, string $v) => $q->where('requested_by', $v))
            ->when($request->boolean('mine') || ! $this->seesAll($user), fn (Builder $q) => $q->where('requested_by', (string) $user->getAuthIdentifier()));
        $this->purchasing->scopeBranches($query, $user);

        ListQuery::apply($query, $request, sortable: ['created_at', 'number', 'estimated_total', 'needed_by', 'submitted_at'], searchable: ['number']);
        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, RequisitionsExport::class, RowSource::fromQuery($query, fn (Collection $rows) => $rows->map($this->presenter->requisitionHeaders($rows))));
        }
        $page = $query->paginate(ListQuery::perPage($request));
        $header = $this->presenter->requisitionHeaders(collect($page->items()));

        return ApiResponse::paginated($page, fn (PurchaseRequisition $r) => new JsonResource($header($r)));
    }

    /**
     * Raise a requisition
     *
     * A draft for a store of the user's branches. Estimated unit costs left empty are prefilled
     * (suggested supplier's catalog cost → preferred catalog cost → last purchase cost → variant
     * cost); the estimate incl. tax is computed by the server.
     */
    public function store(SaveRequisitionRequest $request, SaveRequisition $save): JsonResponse
    {
        $user = $this->user($request);

        return ApiResponse::created($this->presenter->requisition($save($user, null, $request->validated()), $user));
    }

    public function show(Request $request, PurchaseRequisition $requisition): JsonResponse
    {
        $user = $this->visible($request, $requisition);

        return ApiResponse::success($this->presenter->requisition($requisition, $user));
    }

    public function update(SaveRequisitionRequest $request, PurchaseRequisition $requisition, SaveRequisition $save): JsonResponse
    {
        $user = $this->visible($request, $requisition);
        $this->rules->requireAny($user, ['purchases.request', 'purchases.manage']);

        return ApiResponse::success($this->presenter->requisition($save($user, $requisition, $request->validated()), $user));
    }

    /**
     * Submit for approval
     *
     * Decides the approval level from the estimated total; at or below the auto-approve limit
     * the requisition is approved at once. Requires an `Idempotency-Key` header.
     */
    public function submit(Request $request, PurchaseRequisition $requisition, ChangeRequisitionStatus $status): JsonResponse
    {
        $user = $this->visible($request, $requisition);
        $this->rules->requireAny($user, ['purchases.request', 'purchases.manage']);

        return ApiResponse::success($this->presenter->requisition($status->submit($user, $requisition), $user));
    }

    public function approve(Request $request, PurchaseRequisition $requisition, ChangeRequisitionStatus $status): JsonResponse
    {
        $user = $this->visible($request, $requisition);
        $this->rules->requireAny($user, ['purchases.approve', 'purchases.approve_high']);

        return ApiResponse::success($this->presenter->requisition($status->approve($user, $requisition), $user));
    }

    public function reject(Request $request, PurchaseRequisition $requisition, ChangeRequisitionStatus $status): JsonResponse
    {
        $user = $this->visible($request, $requisition);
        $this->rules->requireAny($user, ['purchases.approve', 'purchases.approve_high']);
        $data = $request->validate(['reason' => ['required', 'string', 'max:500']]);

        return ApiResponse::success($this->presenter->requisition($status->reject($user, $requisition, $data['reason']), $user));
    }

    public function cancel(Request $request, PurchaseRequisition $requisition, ChangeRequisitionStatus $status): JsonResponse
    {
        $user = $this->visible($request, $requisition);
        $this->rules->requireAny($user, ['purchases.request', 'purchases.manage']);
        $data = $request->validate(['reason' => ['nullable', 'string', 'max:500']]);

        return ApiResponse::success($this->presenter->requisition($status->cancel($user, $requisition, $data['reason'] ?? null), $user));
    }

    /**
     * Convert to purchase orders and/or an RFQ
     *
     * `purchase_orders.lines` become draft purchase orders grouped by supplier (pre-approved for
     * the requisition's estimate of what they cover); `rfq.lines` go into one draft RFQ.
     * Requires an `Idempotency-Key` header.
     */
    public function convert(ConvertRequisitionRequest $request, PurchaseRequisition $requisition, ConvertRequisition $convert): JsonResponse
    {
        $user = $this->visible($request, $requisition);
        $result = $convert($user, $requisition, $request->validated());

        return ApiResponse::created([
            'requisition' => $this->presenter->requisition($result['requisition'], $user),
            'purchase_orders' => $this->presenter->orderRefs($result['orders']),
            'rfq' => $result['rfq'] === null ? null : ['id' => $result['rfq']->id, 'number' => $result['rfq']->number, 'status' => $result['rfq']->status->value],
        ]);
    }

    /**
     * Cost estimates for the requisition editor
     *
     * `variant_ids[]` (max 100), optional `supplier_id`: per variant the prefilled estimated unit
     * cost, where it came from (`supplier_catalog`, `preferred_catalog`, `last_cost`,
     * `variant_cost`), the tax rate and the preferred supplier.
     */
    public function estimates(Request $request, CostEstimates $estimates): JsonResponse
    {
        $this->rules->requireAny($this->user($request), self::READERS);
        $data = $request->validate([
            'variant_ids' => ['required', 'array', 'min:1', 'max:100'],
            'variant_ids.*' => ['uuid'],
            'supplier_id' => ['sometimes', 'nullable', 'uuid'],
        ]);
        $variantIds = array_values(array_unique($data['variant_ids']));
        $supplier = $data['supplier_id'] ?? null;

        return ApiResponse::success(array_values($estimates->forVariants(
            $this->tenant->requireOrganization(),
            $variantIds,
            $supplier === null ? [] : array_fill_keys($variantIds, $supplier),
        )));
    }

    private function seesAll(TenantUser $user): bool
    {
        return $this->rules->hasAny($user, ['purchases.view', 'purchases.approve', 'purchases.approve_high']);
    }

    /**
     * The requisition when the user may see it (branch, and own unless a reader of all), else 404.
     */
    private function visible(Request $request, PurchaseRequisition $requisition): TenantUser
    {
        $user = $this->user($request);
        $this->rules->requireAny($user, [...self::READERS, 'purchases.manage']);
        $this->purchasing->assertVisible($user, $requisition->branch_id);
        if (! $this->seesAll($user) && ! $this->rules->has($user, 'purchases.manage') && $requisition->requested_by !== (string) $user->getAuthIdentifier()) {
            throw new NotFoundHttpException;
        }

        return $user;
    }

    private function user(Request $request): TenantUser
    {
        /** @var TenantUser */
        return $request->user();
    }
}
