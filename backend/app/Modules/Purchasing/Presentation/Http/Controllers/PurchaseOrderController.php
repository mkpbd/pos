<?php

namespace App\Modules\Purchasing\Presentation\Http\Controllers;

use App\Modules\Purchasing\Application\Actions\ChangePurchaseOrderStatus;
use App\Modules\Purchasing\Application\Actions\SavePurchaseOrder;
use App\Modules\Purchasing\Application\Services\ApprovalRules;
use App\Modules\Purchasing\Domain\PurchaseOrderStatus;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrder;
use App\Modules\Purchasing\Presentation\Http\Exports\PurchaseOrdersExport;
use App\Modules\Purchasing\Presentation\Http\Requests\SavePurchaseOrderRequest;
use App\Modules\Purchasing\Presentation\Http\Support\ProcurementPresenter;
use App\Modules\Purchasing\Presentation\Http\Support\PurchasingPresenter;
use App\Modules\Shared\Application\Contracts\TenantUser;
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

class PurchaseOrderController
{
    public function __construct(
        private readonly PurchasingPresenter $presenter,
        private readonly ProcurementPresenter $procurement,
        private readonly ApprovalRules $rules,
    ) {}

    /**
     * List purchase orders
     *
     * Filters: `status`, `supplier_id`; `search` matches the order number.
     */
    public function index(Request $request, ListExporter $exports): Response
    {
        $request->validate(['status' => ['sometimes', Rule::enum(PurchaseOrderStatus::class)], 'supplier_id' => ['sometimes', 'uuid']]);
        $query = PurchaseOrder::query()
            ->when($request->query('status'), fn (Builder $q, string $v) => $q->where('status', $v))
            ->when($request->query('supplier_id'), fn (Builder $q, string $v) => $q->where('supplier_id', $v));
        $this->presenter->scopeBranches($query, $this->user($request));

        ListQuery::apply($query, $request, sortable: ['created_at', 'order_date', 'number', 'total'], searchable: ['number']);
        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, PurchaseOrdersExport::class, RowSource::fromQuery($query, fn (Collection $orders) => $orders->map($this->presenter->headers($orders))));
        }
        $page = $query->paginate(ListQuery::perPage($request));
        $header = $this->presenter->headers(collect($page->items()));

        return ApiResponse::paginated($page, fn (PurchaseOrder $o) => new JsonResource($header($o)));
    }

    public function store(SavePurchaseOrderRequest $request, SavePurchaseOrder $save): JsonResponse
    {
        return ApiResponse::created($this->present($request, $save($this->user($request), null, $request->validated())));
    }

    public function show(Request $request, PurchaseOrder $order): JsonResponse
    {
        $this->presenter->assertVisible($this->user($request), $order->branch_id);

        return ApiResponse::success($this->present($request, $order));
    }

    public function update(SavePurchaseOrderRequest $request, PurchaseOrder $order, SavePurchaseOrder $save): JsonResponse
    {
        $this->presenter->assertVisible($this->user($request), $order->branch_id);

        return ApiResponse::success($this->present($request, $save($this->user($request), $order, $request->validated())));
    }

    /**
     * Mark a draft as ordered
     *
     * Only when no approval is needed (SC2: approval not required, at or below the auto-approve
     * limit, or pre-approved within 5 %); otherwise `APPROVAL_REQUIRED` — use submit.
     */
    public function place(Request $request, PurchaseOrder $order, ChangePurchaseOrderStatus $status): JsonResponse
    {
        $this->presenter->assertVisible($this->user($request), $order->branch_id);

        return ApiResponse::success($this->present($request, $status->place($order)));
    }

    public function cancel(Request $request, PurchaseOrder $order, ChangePurchaseOrderStatus $status): JsonResponse
    {
        $this->presenter->assertVisible($this->user($request), $order->branch_id);

        return ApiResponse::success($this->present($request, $status->cancel($order)));
    }

    /**
     * Submit a draft (SC2)
     *
     * Ordered at once when no approval is needed, else `pending_approval` (approvers notified).
     * Requires an `Idempotency-Key` header.
     */
    public function submit(Request $request, PurchaseOrder $order, ChangePurchaseOrderStatus $status): JsonResponse
    {
        $this->presenter->assertVisible($this->user($request), $order->branch_id);

        return ApiResponse::success($this->present($request, $status->submit($this->user($request), $order)));
    }

    /**
     * Approve an order pending approval (SC2) → ordered. Requires an `Idempotency-Key` header.
     */
    public function approve(Request $request, PurchaseOrder $order, ChangePurchaseOrderStatus $status): JsonResponse
    {
        $user = $this->user($request);
        $this->presenter->assertVisible($user, $order->branch_id);
        $this->rules->requireAny($user, ['purchases.approve', 'purchases.approve_high']);

        return ApiResponse::success($this->present($request, $status->approve($user, $order)));
    }

    /**
     * Reject an order pending approval (SC2) → back to draft with the reason. Requires an
     * `Idempotency-Key` header.
     */
    public function reject(Request $request, PurchaseOrder $order, ChangePurchaseOrderStatus $status): JsonResponse
    {
        $user = $this->user($request);
        $this->presenter->assertVisible($user, $order->branch_id);
        $this->rules->requireAny($user, ['purchases.approve', 'purchases.approve_high']);
        $data = $request->validate(['reason' => ['required', 'string', 'max:500']]);

        return ApiResponse::success($this->present($request, $status->reject($user, $order, $data['reason'])));
    }

    /**
     * @return array<string, mixed>
     */
    private function present(Request $request, PurchaseOrder $order): array
    {
        return $this->presenter->document($order) + $this->procurement->orderApproval($order, $this->user($request));
    }

    private function user(Request $request): TenantUser
    {
        /** @var TenantUser */
        return $request->user();
    }
}
