<?php

namespace App\Modules\Orders\Presentation\Http\Controllers;

use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Orders\Application\Actions\OrderReturnWorkflow;
use App\Modules\Orders\Domain\RefundMethod;
use App\Modules\Orders\Domain\ReturnStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderReturn;
use App\Modules\Orders\Presentation\Http\Exports\WebOrderReturnsExport;
use App\Modules\Orders\Presentation\Http\Support\ReturnPresenter;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Infrastructure\Http\Exports\RowSource;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

/**
 * Online returns for staff (E10b). Viewing needs `web_orders.view`; creating a return and
 * every step need `web_orders.refund` and an `Idempotency-Key`. Steps return the full return.
 */
class WebOrderReturnController
{
    public function __construct(private readonly ReturnPresenter $presenter) {}

    /**
     * Returns
     *
     * Filters: `status` (requested | approved | received | refunded | rejected | cancelled),
     * `search` (return number, order number, contact name, phone, e-mail). Newest first, 25 per
     * page. Rows: `{id, number, order {id, number}, customer_name, status, status_label,
     * reason_code, reason_label, requested_by, refund_amount, currency, created_at}`.
     * `meta.status_counts`: `{all, <every status>: n}` for the search without `status`.
     */
    public function index(Request $request, CustomerDirectory $customers, TenantContext $tenant, ListExporter $exports): Response
    {
        $request->validate([
            'status' => ['sometimes', 'nullable', Rule::enum(ReturnStatus::class)],
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);
        $search = trim((string) $request->query('search', ''));
        $like = '%'.addcslashes($search, '%_\\').'%';
        $filtered = fn () => OrderReturn::query()->when($search !== '', fn (Builder $q) => $q->where(function (Builder $w) use ($like) {
            $w->whereLike('number', $like)->orWhereHas('order', function (Builder $o) use ($like) {
                $o->where(function (Builder $c) use ($like) {
                    foreach (['number', 'contact_name', 'contact_phone', 'contact_email'] as $column) {
                        $c->orWhereLike($column, $like);
                    }
                });
            });
        }));

        $counts = $filtered()->toBase()->select('status')->selectRaw('count(*) as aggregate')->groupBy('status')->pluck('aggregate', 'status');
        $statusCounts = ['all' => (int) $counts->sum()];
        foreach (ReturnStatus::cases() as $status) {
            $statusCounts[$status->value] = (int) ($counts[$status->value] ?? 0);
        }

        $listed = $filtered()->with('order')
            ->when($request->query('status'), fn (Builder $q, string $v) => $q->where('status', $v))
            ->orderByDesc('created_at')->orderByDesc('id');
        $customerNames = function (Collection $returns) use ($customers, $tenant): array {
            $customerIds = $returns->map(fn (OrderReturn $r) => $r->order->customer_id)->filter()->unique()->values()->all();

            return $customerIds === [] ? [] : $customers->summaries($tenant->requireOrganization(), $customerIds);
        };
        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, WebOrderReturnsExport::class, RowSource::fromQuery($listed, function (Collection $returns) use ($customerNames) {
                $names = $customerNames($returns);

                return $returns->map(fn (OrderReturn $r) => ReturnPresenter::row($r, $names));
            }));
        }
        $page = $listed->paginate(max(1, min(100, (int) $request->query('per_page', 25))));
        $names = $customerNames(collect($page->items()));

        return ApiResponse::paginated($page, fn (OrderReturn $r) => new JsonResource(ReturnPresenter::row($r, $names)), ['status_counts' => $statusCounts]);
    }

    /**
     * Return
     *
     * The row plus `order {id, number, status, payment_status, payment_status_label,
     * payment_method, delivered_at, shipping_total, total, paid_total, refunded_total}`,
     * `customer {id, name, code}|null`, `contact`, notes, `override_window`, `lines [{id,
     * order_line_id, product_id, variant_id, product_name, variant_name, sku, image_url,
     * quantity, requested_quantity, amount, ordered_quantity, unit_price, tax_amount, restock,
     * restocked_quantity}]`, `items_amount`, `shipping_refund`, refund method/reference,
     * step times and actors, `history`, `payments` (the refund ledger entries) and
     * `allowed_actions` (approve, reject | receive | refund; empty without `web_orders.refund`).
     */
    public function show(Request $request, OrderReturn $orderReturn): JsonResponse
    {
        return $this->document($request, $orderReturn);
    }

    /**
     * Create a return (staff)
     *
     * Body as the customer's request (`reason_code, note?, lines`) plus `override_window`
     * (bool): after the return window (or with returns switched off) staff may still accept a
     * return with a `note` (audited). 201 with the return (`requested`, by staff).
     */
    public function store(Request $request, Order $webOrder, OrderReturnWorkflow $workflow): JsonResponse
    {
        $data = $request->validate(AccountReturnController::rules() + ['override_window' => ['sometimes', 'boolean']]);
        $return = $workflow->request($webOrder, $data, 'staff', $this->actor($request));

        return ApiResponse::success($this->presenter->staff($return->fresh() ?? $return, true), 201);
    }

    /**
     * Approve
     *
     * `{lines?: [{order_line_id, quantity}] (lower quantities; 0 drops a line), shipping_refund?
     * (≤ the delivery fee not yet refunded), note? (≤ 500)}`: `requested` → `approved`; amounts
     * are re-valued. The customer is e-mailed.
     */
    public function approve(Request $request, OrderReturn $orderReturn, OrderReturnWorkflow $workflow): JsonResponse
    {
        $data = $request->validate([
            'lines' => ['sometimes', 'array', 'max:50'],
            'lines.*.order_line_id' => ['required', 'uuid'],
            'lines.*.quantity' => ['required', 'numeric', 'min:0', 'max:99999', 'decimal:0,3'],
            'shipping_refund' => ['sometimes', 'nullable', 'numeric', 'min:0', 'decimal:0,2'],
            'note' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);
        $shipping = filled($data['shipping_refund'] ?? null) ? (string) $data['shipping_refund'] : null;

        return $this->document($request, $workflow->approve($orderReturn, $data['lines'] ?? null, $shipping, self::text($data, 'note'), $this->actor($request)));
    }

    /**
     * Reject
     *
     * `{reason}` (≤ 200): `requested` → `rejected`; the quantities are free again. The customer is e-mailed.
     */
    public function reject(Request $request, OrderReturn $orderReturn, OrderReturnWorkflow $workflow): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:200']]);

        return $this->document($request, $workflow->reject($orderReturn, trim($data['reason']), $this->actor($request)));
    }

    /**
     * Goods received
     *
     * `{lines: [{order_line_id, restock: bool}]}`: `approved` → `received`. Restocked lines go
     * back to the exact batches the order took them from, at their cost (`online_return`);
     * the others are written off. Lines not listed are restocked.
     */
    public function receive(Request $request, OrderReturn $orderReturn, OrderReturnWorkflow $workflow): JsonResponse
    {
        $data = $request->validate([
            'lines' => ['present', 'array', 'max:50'],
            'lines.*.order_line_id' => ['required', 'uuid', 'distinct'],
            'lines.*.restock' => ['required', 'boolean'],
        ]);
        $restock = [];
        foreach ($data['lines'] as $line) {
            $restock[(string) $line['order_line_id']] = (bool) $line['restock'];
        }

        return $this->document($request, $workflow->receive($orderReturn, $restock, $this->actor($request)));
    }

    /**
     * Refund
     *
     * `{method: cash|bank_transfer|mobile_banking, reference? (≤ 80)}`: `received` →
     * `refunded`; the refund amount goes out through the payments ledger (`online_order_refund`
     * — cash from your open register session in the order's branch: `CASH_SESSION_REQUIRED`,
     * `INSUFFICIENT_CASH`). The order becomes `partially_refunded` or `refunded`. The customer
     * is e-mailed.
     */
    public function refund(Request $request, OrderReturn $orderReturn, OrderReturnWorkflow $workflow): JsonResponse
    {
        $data = $request->validate([
            'method' => ['required', Rule::enum(RefundMethod::class)],
            'reference' => ['sometimes', 'nullable', 'string', 'max:80'],
        ]);

        return $this->document($request, $workflow->refund($orderReturn, RefundMethod::from($data['method']), self::text($data, 'reference'), $request->user()));
    }

    private function document(Request $request, OrderReturn $return): JsonResponse
    {
        return ApiResponse::success($this->presenter->staff($return->fresh() ?? $return, $request->user()->can('web_orders.refund')));
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private static function text(array $data, string $key): ?string
    {
        return filled($data[$key] ?? null) ? trim((string) $data[$key]) : null;
    }

    private function actor(Request $request): string
    {
        return (string) $request->user()->getAuthIdentifier();
    }
}
