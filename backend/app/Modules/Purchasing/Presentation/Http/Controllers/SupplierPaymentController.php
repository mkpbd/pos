<?php

namespace App\Modules\Purchasing\Presentation\Http\Controllers;

use App\Modules\Purchasing\Application\Actions\RecordSupplierPayment;
use App\Modules\Purchasing\Application\Actions\VoidSupplierMoney;
use App\Modules\Purchasing\Application\Queries\SupplierAccount;
use App\Modules\Purchasing\Infrastructure\Models\SupplierPayment;
use App\Modules\Purchasing\Presentation\Http\Exports\SupplierPaymentsExport;
use App\Modules\Purchasing\Presentation\Http\Exports\SupplierStatementExport;
use App\Modules\Purchasing\Presentation\Http\Requests\RecordSupplierPaymentRequest;
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

/**
 * Supplier payments, balances and statements (accounts payable).
 */
class SupplierPaymentController
{
    public function __construct(private readonly SupplierMoneyPresenter $presenter) {}

    /**
     * Supplier payments
     *
     * Filters: `supplier_id`, `from`/`to` (paid on), ST1: `voided` (true|false; both when omitted).
     */
    public function index(Request $request, ListExporter $exports): Response
    {
        $request->validate([
            'supplier_id' => ['sometimes', 'uuid'], 'from' => ['sometimes', 'date'], 'to' => ['sometimes', 'date'],
            'voided' => ['sometimes', Rule::in(['true', 'false', '1', '0'])],
        ]);
        $query = SupplierPayment::query()
            ->when($request->query('supplier_id'), fn (Builder $q, string $v) => $q->where('supplier_id', $v))
            ->when($request->query('from'), fn (Builder $q, string $v) => $q->where('paid_on', '>=', $v))
            ->when($request->query('to'), fn (Builder $q, string $v) => $q->where('paid_on', '<=', $v))
            ->when($request->has('voided'), fn (Builder $q) => in_array($request->query('voided'), ['true', '1'], true) ? $q->whereNotNull('voided_at') : $q->whereNull('voided_at'));

        ListQuery::apply($query, $request, sortable: ['created_at', 'paid_on', 'amount'], searchable: ['number', 'reference']);
        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, SupplierPaymentsExport::class, RowSource::fromQuery($query, fn (Collection $payments) => $payments->map($this->presenter->presenter($payments))));
        }
        $page = $query->paginate(ListQuery::perPage($request));
        $present = $this->presenter->presenter(collect($page->items()));

        return ApiResponse::paginated($page, fn (SupplierPayment $p) => new JsonResource($present($p)));
    }

    /**
     * Record a supplier payment
     *
     * `{supplier_id, amount, method, paid_on, reference?, notes?, branch_id?}`; methods: cash,
     * bank_transfer, mobile_banking, cheque, card. ST1: booked in the payments ledger — cash
     * comes out of the caller's open register session drawer (CASH_SESSION_REQUIRED,
     * INSUFFICIENT_CASH); without `branch_id` the session's branch (or the user's only branch)
     * is used. Requires an `Idempotency-Key`.
     */
    public function store(RecordSupplierPaymentRequest $request, RecordSupplierPayment $record): JsonResponse
    {
        /** @var TenantUser $user */
        $user = $request->user();
        $payment = $record($user, $request->validated());

        return ApiResponse::created(($this->presenter->presenter(collect([$payment])))($payment));
    }

    /**
     * Void a supplier payment
     *
     * `{reason}`. ST1: books the opposite ledger entry (cash back into the caller's drawer);
     * the statement keeps the payment and shows the void. ALREADY_VOIDED on a second void.
     */
    public function void(Request $request, SupplierPayment $supplierPayment, VoidSupplierMoney $void): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:255']]);
        /** @var TenantUser $user */
        $user = $request->user();
        $payment = $void->payment($user, $supplierPayment, trim($data['reason']));

        return ApiResponse::success(($this->presenter->presenter(collect([$payment])))($payment));
    }

    /**
     * Supplier balances
     *
     * `supplier_ids[]` (max 100). Positive = owed to the supplier.
     */
    public function balances(Request $request, SupplierAccount $account): JsonResponse
    {
        $data = $request->validate(['supplier_ids' => ['required', 'array', 'max:100'], 'supplier_ids.*' => ['uuid']]);

        return ApiResponse::success((object) $account->balances($data['supplier_ids']));
    }

    /**
     * Supplier statement
     *
     * Receipts (+), returns (−), payments (−) and ST1 refunds (+) with running balance; a void
     * adds an opposite line (`payment_void` +, `refund_void` −) on its day. `from`/`to` limit the period.
     */
    public function statement(Request $request, string $supplierId, SupplierAccount $account, ListExporter $exports, SupplierStatementExport $export): Response
    {
        $data = $request->validate(['from' => ['sometimes', 'date_format:Y-m-d'], 'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from']]);

        $statement = $account->statement($supplierId, $data['from'] ?? null, $data['to'] ?? null);
        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, $export, RowSource::fromRows($export->rows($statement, $data['from'] ?? null, $data['to'] ?? null)));
        }

        return ApiResponse::success($statement);
    }
}
