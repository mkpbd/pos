<?php

namespace App\Modules\Purchasing\Presentation\Http\Controllers;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Purchasing\Application\Actions\CreateReorderPurchaseOrders;
use App\Modules\Purchasing\Application\Actions\CreateReorderRequisition;
use App\Modules\Purchasing\Application\Actions\CreateReorderTransfer;
use App\Modules\Purchasing\Application\Queries\ReorderSuggestions;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrder;
use App\Modules\Purchasing\Presentation\Http\Exports\ReorderSuggestionsExport;
use App\Modules\Purchasing\Presentation\Http\Requests\CreateReorderPurchaseOrdersRequest;
use App\Modules\Purchasing\Presentation\Http\Requests\CreateReorderRequisitionRequest;
use App\Modules\Purchasing\Presentation\Http\Requests\CreateReorderTransferRequest;
use App\Modules\Purchasing\Presentation\Http\Support\ProcurementPresenter;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Infrastructure\Http\Exports\RowSource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

/**
 * Reorder suggestions for a store and the documents created from them (SC1).
 */
class ReorderSuggestionController
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly StoreAccess $storeAccess,
        private readonly SupplierDirectory $suppliers,
        private readonly BranchDirectory $branches,
    ) {}

    /**
     * Reorder suggestions
     *
     * For `store_id` (a store of the user's branches): variants to transfer from the source
     * store and/or buy from their preferred supplier. Filters: `supplier_id`, `search`,
     * `only=purchase|transfer`. `meta` carries the store, the source store and the settings.
     */
    public function index(Request $request, ReorderSuggestions $suggestions, ListExporter $exports): Response
    {
        $request->validate([
            'store_id' => ['required', 'uuid'],
            'supplier_id' => ['sometimes', 'uuid'],
            'search' => ['sometimes', 'string', 'max:100'],
            'only' => ['sometimes', Rule::in(['purchase', 'transfer'])],
        ]);
        $store = $this->storeAccess->require($this->user($request), (string) $request->query('store_id'));
        $result = $suggestions->forStore($this->tenant->requireOrganization(), $store['id'], [
            'supplier_id' => $request->query('supplier_id'),
            'search' => $request->query('search'),
            'only' => $request->query('only'),
        ]);

        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, ReorderSuggestionsExport::class, RowSource::fromRows($result['rows']));
        }

        $perPage = ListQuery::perPage($request);
        $current = max(1, (int) $request->query('page', 1));
        $page = new LengthAwarePaginator(
            array_slice($result['rows'], ($current - 1) * $perPage, $perPage),
            count($result['rows']),
            $perPage,
            $current,
        );

        return ApiResponse::paginated($page, fn (array $row) => new JsonResource($row), [
            'store' => ['id' => $store['id'], 'code' => $store['code'], 'name' => $store['name'], 'branch_id' => $store['branch_id'], 'branch_name' => $store['branch_name']],
            'source_store' => $result['source_store'],
            'settings' => array_diff_key($result['settings'], ['source_store_id' => true]),
        ]);
    }

    /**
     * Create purchase orders from suggestions
     *
     * One draft purchase order per supplier. Requires an `Idempotency-Key` header.
     */
    public function purchaseOrders(CreateReorderPurchaseOrdersRequest $request, CreateReorderPurchaseOrders $create): JsonResponse
    {
        $orders = $create($this->user($request), $request->validated());
        $suppliers = $this->suppliers->summaries($this->tenant->requireOrganization(), array_map(fn (PurchaseOrder $o) => $o->supplier_id, $orders));

        return ApiResponse::created(['purchase_orders' => array_map(fn (PurchaseOrder $o) => [
            'id' => $o->id,
            'number' => $o->number,
            'status' => $o->status->value,
            'supplier' => $suppliers[$o->supplier_id] ?? null,
            'line_count' => $o->lines()->count(),
            'total' => $o->total,
            'expected_date' => $o->expected_date?->toDateString(),
        ], $orders)]);
    }

    /**
     * Raise a requisition from suggestions (SC2)
     *
     * For branch staff without `purchases.manage`: one draft requisition for the store (the
     * line's supplier becomes the suggested supplier, the unit cost the estimate — prefilled when
     * omitted); `submit: true` submits it at once. Requires an `Idempotency-Key` header.
     */
    public function requisitions(CreateReorderRequisitionRequest $request, CreateReorderRequisition $create, ProcurementPresenter $presenter): JsonResponse
    {
        $user = $this->user($request);

        return ApiResponse::created($presenter->requisition($create($user, $request->validated()), $user));
    }

    /**
     * Create a transfer from suggestions
     *
     * One transfer from the source store, dispatched (in transit) at once — transfers have no
     * draft state. Requires an `Idempotency-Key` header.
     */
    public function transfers(CreateReorderTransferRequest $request, CreateReorderTransfer $create): JsonResponse
    {
        $transfer = $create($this->user($request), $request->validated());
        $stores = $this->branches->storeSummaries($this->tenant->requireOrganization(), [$transfer['from_store_id'], $transfer['to_store_id']]);

        return ApiResponse::created(['transfers' => [[
            'id' => $transfer['id'],
            'number' => $transfer['number'],
            'status' => $transfer['status'],
            'from_store' => $stores[$transfer['from_store_id']] ?? null,
            'to_store' => $stores[$transfer['to_store_id']] ?? null,
            'lines_count' => $transfer['line_count'],
        ]]]);
    }

    private function user(Request $request): TenantUser
    {
        /** @var TenantUser */
        return $request->user();
    }
}
