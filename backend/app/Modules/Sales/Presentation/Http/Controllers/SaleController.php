<?php

namespace App\Modules\Sales\Presentation\Http\Controllers;

use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Sales\Application\Actions\CancelSale;
use App\Modules\Sales\Application\Queries\SalesSummary;
use App\Modules\Sales\Application\Services\CustomerCredit;
use App\Modules\Sales\Application\Services\SalesContext;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Presentation\Http\Exports\SalesExport;
use App\Modules\Sales\Presentation\Http\Support\SalePresenter;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Infrastructure\Http\Exports\RowSource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

/**
 * Sales history, invoices (with receipt data), cancellation and the daily summary.
 */
class SaleController
{
    public function __construct(
        private readonly SalePresenter $presenter,
        private readonly SalesContext $context,
    ) {}

    /**
     * Sales history
     *
     * Filters: `branch_id`, `store_id`, `customer_id`, `cashier_id`, `status`, `from`/`to`
     * (calendar days in the organization's timezone); `search` matches the invoice number.
     * Users without `sales.view` (POS-only) see the sales they rang up.
     */
    public function index(Request $request, ListExporter $exports): Response
    {
        $request->validate([
            'branch_id' => ['sometimes', 'uuid'],
            'store_id' => ['sometimes', 'uuid'],
            'customer_id' => ['sometimes', 'uuid'],
            'cashier_id' => ['sometimes', 'uuid'],
            'status' => ['sometimes', Rule::in(['completed', 'cancelled'])],
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);
        $timezone = $this->context->organization()['timezone'] ?? config('app.timezone');
        $day = fn (string $date) => Carbon::parse($date, $timezone)->startOfDay()->setTimezone(config('app.timezone'));

        $query = Sale::query()
            ->when($request->query('branch_id'), fn (Builder $q, string $v) => $q->where('branch_id', $v))
            ->when($request->query('store_id'), fn (Builder $q, string $v) => $q->where('store_id', $v))
            ->when($request->query('customer_id'), fn (Builder $q, string $v) => $q->where('customer_id', $v))
            ->when($request->query('cashier_id'), fn (Builder $q, string $v) => $q->where('created_by', $v))
            ->when($request->query('status'), fn (Builder $q, string $v) => $q->where('status', $v))
            ->when($request->query('from'), fn (Builder $q, string $v) => $q->where('sold_at', '>=', $day($v)))
            ->when($request->query('to'), fn (Builder $q, string $v) => $q->where('sold_at', '<', $day($v)->addDay()));
        $this->presenter->scopeVisible($query, $this->user($request));

        ListQuery::apply($query, $request, sortable: ['sold_at', 'number', 'total'], searchable: ['number'], defaultSort: '-sold_at');
        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, SalesExport::class, RowSource::fromQuery($query, fn (Collection $sales) => $sales->map($this->presenter->headers($sales))));
        }
        $page = $query->paginate(ListQuery::perPage($request));
        $header = $this->presenter->headers(collect($page->items()));

        return ApiResponse::paginated($page, fn (Sale $s) => new JsonResource($header($s)));
    }

    /**
     * Invoice
     *
     * Includes lines (with batches and serial numbers), payments and the data a receipt
     * prints. Cost figures only with `products.view_cost`.
     */
    public function show(Request $request, Sale $sale): JsonResponse
    {
        $this->presenter->assertVisible($this->user($request), $sale);

        return ApiResponse::success($this->presenter->document($sale, $request->user()->can('products.view_cost')));
    }

    /**
     * Cancel a sale
     *
     * Restocks every line to the batches it came from, records negative payment reversals
     * (hand the money back) and releases serial numbers. `SALE_ALREADY_CANCELLED` when repeated.
     */
    public function cancel(Request $request, Sale $sale, CancelSale $cancel): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:255']]);
        $user = $this->user($request);
        if (! $user->canAccessBranch($sale->branch_id)) {
            abort(404);
        }

        return ApiResponse::success($this->presenter->document($cancel($user, $sale, trim($data['reason'])), $request->user()->can('products.view_cost')));
    }

    /**
     * Daily sales summary
     *
     * `date` (default today in the organization's timezone) and optional `branch_id`.
     * `cost` and `gross_profit` are `null` without `products.view_cost`.
     */
    public function summary(Request $request, SalesSummary $summary): JsonResponse
    {
        $data = $request->validate([
            'date' => ['sometimes', 'date_format:Y-m-d'],
            'branch_id' => ['sometimes', 'uuid'],
        ]);
        $timezone = $this->context->organization()['timezone'] ?? config('app.timezone');
        $result = $summary($this->user($request), $data['date'] ?? now($timezone)->toDateString(), $data['branch_id'] ?? null);
        if (! $request->user()->can('products.view_cost')) {
            $result['cost'] = null;
            $result['gross_profit'] = null;
        }

        return ApiResponse::success($result);
    }

    /**
     * Customer balances
     *
     * `{customer_id: amount owed}` = opening balance + dues of completed sales.
     */
    public function customerBalances(Request $request, CustomerCredit $credit, CustomerDirectory $customers): JsonResponse
    {
        $data = $request->validate([
            'customer_ids' => ['required', 'array', 'max:100'],
            'customer_ids.*' => ['uuid'],
        ]);
        $ids = array_values(array_unique($data['customer_ids']));
        $opening = $customers->openingBalances($this->context->organizationId(), $ids);
        $dues = $credit->dues(array_keys($opening));

        return ApiResponse::success(array_map(
            fn (string $id) => Decimal::add($opening[$id], $dues[$id] ?? '0', 2),
            array_combine(array_keys($opening), array_keys($opening)),
        ));
    }

    private function user(Request $request): TenantUser
    {
        /** @var TenantUser */
        return $request->user();
    }
}
