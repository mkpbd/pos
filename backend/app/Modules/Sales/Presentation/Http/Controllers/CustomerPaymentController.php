<?php

namespace App\Modules\Sales\Presentation\Http\Controllers;

use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Payments\Domain\PaymentMethod;
use App\Modules\Sales\Application\Actions\ReceiveCustomerPayment;
use App\Modules\Sales\Application\Queries\CustomerAccount;
use App\Modules\Sales\Application\Services\SalesContext;
use App\Modules\Sales\Infrastructure\Models\CustomerPayment;
use App\Modules\Sales\Presentation\Http\Exports\CustomerPaymentsExport;
use App\Modules\Sales\Presentation\Http\Exports\CustomerStatementExport;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Infrastructure\Http\Exports\RowSource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * Accounts receivable: payments customers make against what they owe, and statements.
 */
class CustomerPaymentController
{
    public function __construct(
        private readonly SalesContext $context,
        private readonly CustomerDirectory $customers,
        private readonly UserDirectory $users,
    ) {}

    /**
     * Customer payments
     *
     * Filters: `customer_id`, `branch_id`; `search` matches number or reference.
     */
    public function index(Request $request, ListExporter $exports): Response
    {
        $request->validate(['customer_id' => ['sometimes', 'uuid'], 'branch_id' => ['sometimes', 'uuid']]);
        $accessible = $this->user($request)->accessibleBranchIds();
        $query = CustomerPayment::query()
            ->when($accessible !== null, fn (Builder $q) => $q->whereIn('branch_id', $accessible))
            ->when($request->query('customer_id'), fn (Builder $q, string $v) => $q->where('customer_id', $v))
            ->when($request->query('branch_id'), fn (Builder $q, string $v) => $q->where('branch_id', $v));

        ListQuery::apply($query, $request, sortable: ['created_at', 'amount'], searchable: ['number', 'reference']);
        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, CustomerPaymentsExport::class, RowSource::fromQuery($query, fn (Collection $payments) => $payments->map($this->presenter($payments))));
        }
        $page = $query->paginate(ListQuery::perPage($request));
        $present = $this->presenter(collect($page->items()));

        return ApiResponse::paginated($page, fn (CustomerPayment $p) => new JsonResource($present($p)));
    }

    /**
     * Receive a payment
     *
     * `{customer_id, branch_id, amount, method, reference?, notes?}`; methods: cash, card,
     * mobile_banking, bank_transfer, cheque. At most the outstanding balance
     * (`PAYMENT_EXCEEDS_BALANCE`); cash needs an open register session. Requires an `Idempotency-Key`.
     */
    public function store(Request $request, ReceiveCustomerPayment $receive): JsonResponse
    {
        $data = $request->validate([
            'customer_id' => ['required', 'uuid'],
            'branch_id' => ['required', 'uuid'],
            'amount' => ['required', 'decimal:0,2', 'gt:0', 'max:99999999'],
            'method' => ['required', Rule::enum(PaymentMethod::class)],
            'reference' => ['sometimes', 'nullable', 'string', 'max:100'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ]);
        $payment = $receive($this->user($request), $data);

        return ApiResponse::created(($this->presenter(collect([$payment])))($payment));
    }

    /**
     * Customer statement
     *
     * Invoices, till payments, cancellations, returns, refunds and payments with a running
     * balance (positive = owed by the customer). `from`/`to` limit the period. Needs
     * `sales.view` or `payments.view`.
     */
    public function statement(Request $request, string $customerId, CustomerAccount $account, ListExporter $exports, CustomerStatementExport $export): Response
    {
        if (! Gate::forUser($request->user())->any(['sales.view', 'payments.view'])) {
            throw new AccessDeniedHttpException;
        }
        $data = $request->validate(['from' => ['sometimes', 'date_format:Y-m-d'], 'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from']]);

        $statement = $account->statement($customerId, $data['from'] ?? null, $data['to'] ?? null);
        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, $export, RowSource::fromRows($export->rows($statement, $data['from'] ?? null, $data['to'] ?? null)));
        }

        return ApiResponse::success($statement);
    }

    /**
     * @param  iterable<CustomerPayment>  $payments
     * @return callable(CustomerPayment): array<string, mixed>
     */
    private function presenter(iterable $payments): callable
    {
        $payments = collect($payments);
        $org = $this->context->organizationId();
        $customers = $this->customers->summaries($org, $payments->pluck('customer_id')->unique()->values()->all());
        $users = $this->users->names($org, $payments->pluck('created_by')->filter()->unique()->values()->all());

        return fn (CustomerPayment $p) => [
            'id' => $p->id,
            'number' => $p->number,
            'customer' => $customers[$p->customer_id] ?? null,
            'branch_id' => $p->branch_id,
            'currency' => $p->currency,
            'amount' => $p->amount,
            'method' => $p->method,
            'method_label' => PaymentMethod::tryFrom($p->method)?->label() ?? $p->method,
            'reference' => $p->reference,
            'notes' => $p->notes,
            'created_by' => $p->created_by === null ? null : ['id' => $p->created_by, 'name' => $users[$p->created_by] ?? null],
            'created_at' => $p->created_at->toIso8601String(),
        ];
    }

    private function user(Request $request): TenantUser
    {
        /** @var TenantUser */
        return $request->user();
    }
}
