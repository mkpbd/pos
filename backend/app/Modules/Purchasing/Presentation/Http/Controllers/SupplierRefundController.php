<?php

namespace App\Modules\Purchasing\Presentation\Http\Controllers;

use App\Modules\Purchasing\Application\Actions\RecordSupplierRefund;
use App\Modules\Purchasing\Application\Actions\VoidSupplierMoney;
use App\Modules\Purchasing\Infrastructure\Models\SupplierRefund;
use App\Modules\Purchasing\Presentation\Http\Exports\SupplierRefundsExport;
use App\Modules\Purchasing\Presentation\Http\Requests\RecordSupplierRefundRequest;
use App\Modules\Purchasing\Presentation\Http\Support\SupplierMoneyPresenter;
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
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * ST1: money suppliers give back (overpayments, credit for returned goods).
 */
class SupplierRefundController
{
    public function __construct(private readonly SupplierMoneyPresenter $presenter) {}

    /**
     * Supplier refunds
     *
     * Refunds of the branches the caller may access. Filters: `supplier_id`, `branch_id`,
     * `from`/`to` (received on), `voided` (true|false; both when omitted); `search` matches
     * number or reference. `?export=xlsx|csv|pdf`.
     */
    public function index(Request $request, ListExporter $exports): Response
    {
        $request->validate([
            'supplier_id' => ['sometimes', 'uuid'], 'branch_id' => ['sometimes', 'uuid'],
            'from' => ['sometimes', 'date_format:Y-m-d'], 'to' => ['sometimes', 'date_format:Y-m-d'],
            'voided' => ['sometimes', Rule::in(['true', 'false', '1', '0'])],
        ]);
        /** @var TenantUser $user */
        $user = $request->user();
        $accessible = $user->accessibleBranchIds();

        $query = SupplierRefund::query()
            ->when($accessible !== null, fn (Builder $q) => $q->whereIn('branch_id', $accessible))
            ->when($request->query('supplier_id'), fn (Builder $q, string $v) => $q->where('supplier_id', $v))
            ->when($request->query('branch_id'), fn (Builder $q, string $v) => $q->where('branch_id', $v))
            ->when($request->query('from'), fn (Builder $q, string $v) => $q->where('received_on', '>=', $v))
            ->when($request->query('to'), fn (Builder $q, string $v) => $q->where('received_on', '<=', $v))
            ->when($request->has('voided'), fn (Builder $q) => in_array($request->query('voided'), ['true', '1'], true) ? $q->whereNotNull('voided_at') : $q->whereNull('voided_at'));

        ListQuery::apply($query, $request, sortable: ['created_at', 'received_on', 'amount'], searchable: ['number', 'reference'], defaultSort: '-received_on');
        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, SupplierRefundsExport::class, RowSource::fromQuery($query, fn (Collection $refunds) => $refunds->map($this->presenter->presenter($refunds))));
        }
        $page = $query->paginate(ListQuery::perPage($request));
        $present = $this->presenter->presenter(collect($page->items()));

        return ApiResponse::paginated($page, fn (SupplierRefund $r) => new JsonResource($present($r)));
    }

    public function show(Request $request, SupplierRefund $supplierRefund): JsonResponse
    {
        /** @var TenantUser $user */
        $user = $request->user();
        if (! $user->canAccessBranch($supplierRefund->branch_id)) {
            throw new NotFoundHttpException;
        }

        return ApiResponse::success(($this->presenter->presenter(collect([$supplierRefund])))($supplierRefund));
    }

    /**
     * Record a supplier refund
     *
     * `{supplier_id, amount, method, received_on, reference?, branch_id?, notes?}` → `SREF-` number.
     * Money in through the payments ledger: cash goes into the caller's open register session
     * drawer (CASH_SESSION_REQUIRED without one). Raises what is owed to the supplier on the
     * statement. Requires an `Idempotency-Key`.
     */
    public function store(RecordSupplierRefundRequest $request, RecordSupplierRefund $record): JsonResponse
    {
        /** @var TenantUser $user */
        $user = $request->user();
        $refund = $record($user, $request->validated());

        return ApiResponse::created(($this->presenter->presenter(collect([$refund])))($refund));
    }

    /**
     * Void a supplier refund
     *
     * `{reason}`. Books the opposite ledger entry (cash out of the caller's drawer again,
     * INSUFFICIENT_CASH when short); ALREADY_VOIDED on a second void.
     */
    public function void(Request $request, SupplierRefund $supplierRefund, VoidSupplierMoney $void): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:255']]);
        /** @var TenantUser $user */
        $user = $request->user();
        $refund = $void->refund($user, $supplierRefund, trim($data['reason']));

        return ApiResponse::success(($this->presenter->presenter(collect([$refund])))($refund));
    }
}
