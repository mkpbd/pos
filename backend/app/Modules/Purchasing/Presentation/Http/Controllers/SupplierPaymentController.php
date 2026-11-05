<?php

namespace App\Modules\Purchasing\Presentation\Http\Controllers;

use App\Modules\Purchasing\Application\Actions\RecordSupplierPayment;
use App\Modules\Purchasing\Application\Queries\SupplierAccount;
use App\Modules\Purchasing\Infrastructure\Models\SupplierPayment;
use App\Modules\Purchasing\Presentation\Http\Exports\SupplierPaymentsExport;
use App\Modules\Purchasing\Presentation\Http\Exports\SupplierStatementExport;
use App\Modules\Purchasing\Presentation\Http\Requests\RecordSupplierPaymentRequest;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Infrastructure\Http\Exports\RowSource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;
use Symfony\Component\HttpFoundation\Response;

/**
 * Supplier payments, balances and statements (accounts payable).
 */
class SupplierPaymentController
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly SupplierDirectory $suppliers,
    ) {}

    public function index(Request $request, ListExporter $exports): Response
    {
        $request->validate(['supplier_id' => ['sometimes', 'uuid'], 'from' => ['sometimes', 'date'], 'to' => ['sometimes', 'date']]);
        $query = SupplierPayment::query()
            ->when($request->query('supplier_id'), fn (Builder $q, string $v) => $q->where('supplier_id', $v))
            ->when($request->query('from'), fn (Builder $q, string $v) => $q->where('paid_on', '>=', $v))
            ->when($request->query('to'), fn (Builder $q, string $v) => $q->where('paid_on', '<=', $v));

        ListQuery::apply($query, $request, sortable: ['created_at', 'paid_on', 'amount'], searchable: ['number', 'reference']);
        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, SupplierPaymentsExport::class, RowSource::fromQuery($query, function (Collection $payments) {
                $suppliers = $this->suppliers->summaries($this->tenant->requireOrganization(), $payments->pluck('supplier_id')->all());

                return $payments->map(fn (SupplierPayment $p) => $this->present($p, $suppliers));
            }));
        }
        $page = $query->paginate(ListQuery::perPage($request));
        $suppliers = $this->suppliers->summaries($this->tenant->requireOrganization(), collect($page->items())->pluck('supplier_id')->all());

        return ApiResponse::paginated($page, fn (SupplierPayment $p) => new JsonResource($this->present($p, $suppliers)));
    }

    public function store(RecordSupplierPaymentRequest $request, RecordSupplierPayment $record): JsonResponse
    {
        /** @var TenantUser $user */
        $user = $request->user();
        $payment = $record($user, $request->validated());
        $suppliers = $this->suppliers->summaries($this->tenant->requireOrganization(), [$payment->supplier_id]);

        return ApiResponse::created($this->present($payment, $suppliers));
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
     * Receipts (+), returns (−) and payments (−) with running balance; `from`/`to` limit the period.
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

    /**
     * @param  array<string, array<string, mixed>>  $suppliers
     * @return array<string, mixed>
     */
    private function present(SupplierPayment $p, array $suppliers): array
    {
        return [
            'id' => $p->id,
            'number' => $p->number,
            'supplier' => $suppliers[$p->supplier_id] ?? null,
            'branch_id' => $p->branch_id,
            'currency' => $p->currency,
            'amount' => $p->amount,
            'method' => $p->method->value,
            'reference' => $p->reference,
            'paid_on' => $p->paid_on->toDateString(),
            'notes' => $p->notes,
            'created_by' => $p->created_by,
            'created_at' => $p->created_at?->toIso8601String(),
        ];
    }
}
