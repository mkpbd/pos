<?php

namespace App\Modules\Orders\Presentation\Http\Controllers;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\Orders\Application\Actions\CancelOrder;
use App\Modules\Orders\Application\Actions\OrderWorkflow;
use App\Modules\Orders\Application\Actions\ProcessOrdersInBulk;
use App\Modules\Orders\Domain\OrderPaymentMethod;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Domain\PaymentStatus;
use App\Modules\Orders\Domain\RefundMethod;
use App\Modules\Orders\Domain\ShipmentStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Presentation\Http\Support\OrderPresenter;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Web orders for staff: list, detail and the workflow steps. Viewing needs
 * `web_orders.view`; every step needs `web_orders.manage` and an `Idempotency-Key`, and
 * returns the full order.
 */
class WebOrderController
{
    public function __construct(private readonly OrderPresenter $presenter) {}

    /**
     * Web orders (the orders board)
     *
     * Filters: `status`, `payment_status`, `payment_method` (cod | bank_transfer),
     * `courier_id` (the shipment's courier), `district_id` (shipping address),
     * `date_from`/`date_to` (alias `from`/`to`; calendar days of placed_at in the
     * organization's timezone), `cod_unremitted=1` (delivered cash-on-delivery orders still
     * unpaid: the courier owes the money); `search` matches number, contact name, phone and
     * e-mail. Newest first, 25 per page. Rows: `{id, number, placed_at, status, status_label,
     * payment_status, payment_method, contact_name, contact_phone, total, currency,
     * item_count, district, courier_name, tracking_number, shipment_status, delivered_at}`.
     * `meta.status_counts`: `{all, <every status>: n, cod_unremitted}` for the current
     * filters except `status` (and except `cod_unremitted` for its own count).
     */
    public function index(Request $request, OrganizationDirectory $organizations, TenantContext $tenant): JsonResponse
    {
        $request->validate([
            'status' => ['sometimes', Rule::enum(OrderStatus::class)],
            'payment_status' => ['sometimes', Rule::enum(PaymentStatus::class)],
            'payment_method' => ['sometimes', Rule::enum(OrderPaymentMethod::class)],
            'courier_id' => ['sometimes', 'uuid'],
            'district_id' => ['sometimes', 'integer', 'min:1'],
            'cod_unremitted' => ['sometimes', 'boolean'],
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
            'date_from' => ['sometimes', 'date_format:Y-m-d'],
            'date_to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:date_from'],
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
        ]);
        $timezone = $organizations->summary($tenant->requireOrganization())['timezone'] ?? config('app.timezone');
        $day = fn (string $date) => Carbon::parse($date, $timezone)->startOfDay()->setTimezone(config('app.timezone'));
        $from = $request->query('date_from') ?? $request->query('from');
        $to = $request->query('date_to') ?? $request->query('to');
        $search = trim((string) $request->query('search', ''));
        $codUnremitted = fn (Builder $q) => $q->where('payment_method', OrderPaymentMethod::CashOnDelivery->value)
            ->where('status', OrderStatus::Delivered->value)
            ->where('payment_status', PaymentStatus::Unpaid->value);

        $filtered = fn (bool $withCodUnremitted) => Order::query()
            ->when($request->query('payment_status'), fn (Builder $q, string $v) => $q->where('payment_status', $v))
            ->when($request->query('payment_method'), fn (Builder $q, string $v) => $q->where('payment_method', $v))
            ->when($request->query('courier_id'), fn (Builder $q, string $v) => $q->whereHas('shipment', fn (Builder $s) => $s->where('courier_id', $v)))
            ->when($request->query('district_id'), fn (Builder $q, $v) => $q->whereHas('shippingAddress', fn (Builder $a) => $a->where('district_id', (int) $v)))
            ->when($withCodUnremitted && $request->boolean('cod_unremitted'), $codUnremitted)
            ->when(is_string($from), fn (Builder $q) => $q->where('placed_at', '>=', $day($from)))
            ->when(is_string($to), fn (Builder $q) => $q->where('placed_at', '<', $day($to)->addDay()))
            ->when($search !== '', fn (Builder $q) => $q->where(function (Builder $w) use ($search) {
                foreach (['number', 'contact_name', 'contact_phone', 'contact_email'] as $column) {
                    $w->orWhereLike($column, '%'.addcslashes($search, '%_\\').'%');
                }
            }));

        $counts = $filtered(true)->toBase()->select('status')->selectRaw('count(*) as aggregate')->groupBy('status')->pluck('aggregate', 'status');
        $statusCounts = ['all' => (int) $counts->sum()];
        foreach (OrderStatus::cases() as $status) {
            $statusCounts[$status->value] = (int) ($counts[$status->value] ?? 0);
        }
        $statusCounts['cod_unremitted'] = $codUnremitted($filtered(false))->count();

        $query = $filtered(true)
            ->with(['shippingAddress', 'shipment'])
            ->withSum('lines', 'quantity')
            ->when($request->query('status'), fn (Builder $q, string $v) => $q->where('status', $v));
        $page = ListQuery::paginate($query, $request, sortable: ['placed_at', 'number', 'total'], defaultSort: '-placed_at');

        return ApiResponse::paginated(
            $page,
            fn (Order $o) => new JsonResource(OrderPresenter::row($o, Decimal::round((string) ($o->getAttribute('lines_sum_quantity') ?? '0'), 3))),
            ['status_counts' => $statusCounts],
        );
    }

    /**
     * Print orders
     *
     * `?ids[]=…` (1–100 orders) `&kind=packing_slip|invoice`. Read-only. Returns `{kind,
     * organization: {name, legal_name, address, phone, email, tax_number, logo_url},
     * orders: [...]}` in the requested order. Per order: `id, number, placed_at, status,
     * status_label, contact {name, email, phone}, shipping_address, payment_method,
     * payment_method_label, payment_status, payment_status_label, shipping_method_name,
     * courier_name, tracking_number, tracking_url, notes, item_count, lines [{product_name,
     * variant_name, sku, quantity}]`; an invoice adds per line `unit_price, line_subtotal,
     * discount_amount, tax_rate, tax_amount, line_total` and `currency, prices_include_tax,
     * subtotal, discount_total, tax_total, shipping_total, shipping_discount, cod_fee,
     * promotions, coupon_code, total, paid_total, balance_due`. An id that is not an order of
     * this organization: 404.
     */
    public function print(Request $request, OrganizationDirectory $organizations, TenantContext $tenant, StorefrontConfig $storefront, MediaLibrary $media): JsonResponse
    {
        $data = $request->validate([
            'ids' => ['required', 'array', 'min:1', 'max:100'],
            'ids.*' => ['required', 'uuid'],
            'kind' => ['required', Rule::in(['packing_slip', 'invoice'])],
        ]);
        $ids = array_values(array_unique($data['ids']));
        $orders = Order::query()->whereIn('id', $ids)->with(['lines', 'shippingAddress', 'history', 'promotions', 'shipment'])->get()->keyBy('id');
        if ($orders->count() !== count($ids)) {
            throw new NotFoundHttpException;
        }

        $organization = $organizations->summary($tenant->requireOrganization()) ?? [];
        $logoId = $storefront->theme()->settings['logo_media_id'] ?? null;
        $logo = is_string($logoId) ? ($media->refs([$logoId])[$logoId]['url'] ?? null) : null;

        return ApiResponse::success([
            'kind' => $data['kind'],
            'organization' => [
                'name' => $organization['name'] ?? '',
                'legal_name' => $organization['legal_name'] ?? null,
                'address' => $organization['address'] ?? null,
                'phone' => $organization['phone'] ?? null,
                'email' => $organization['email'] ?? null,
                'tax_number' => $organization['tax_number'] ?? null,
                'logo_url' => $logo,
            ],
            'orders' => array_map(fn (string $id) => $this->presenter->printable($orders[$id], $data['kind']), $ids),
        ]);
    }

    /**
     * Web order
     *
     * The order view the shopper sees plus `id`, `customer` (`{id, name, code}` or null for
     * guests), `ip`, `user_agent`, `notes`, cancellation, status history with actor names,
     * `payments` (`[{method, amount, reference, recorded_at, recorded_by}]`) and
     * `allowed_actions` (subset of confirm_payment, process, ship, deliver, record_cod_payment,
     * cancel; empty without `web_orders.manage`). E10b: per line `id` and
     * `returnable_quantity`, `refunded_total`, `return_deadline`, `return_window_open`,
     * `returns [{id, number, status, status_label, refund_amount, created_at}]`, refunds in
     * `payments` (direction `out`) and `create_return` in `allowed_actions` (with
     * `web_orders.refund`, delivered and paid orders with something left to return â€”
     * after the window only with `override_window`).
     */
    public function show(Request $request, Order $webOrder): JsonResponse
    {
        return $this->document($request, $webOrder);
    }

    /**
     * Confirm a bank transfer
     *
     * `pending_payment` → `confirmed`, paid; records the order total as `bank_transfer` in the
     * payments ledger with the staff-entered `reference`. `ORDER_ALREADY_PAID` when repeated.
     */
    public function confirmPayment(Request $request, Order $webOrder, OrderWorkflow $workflow): JsonResponse
    {
        $data = $request->validate(['reference' => ['required', 'string', 'max:80']]);

        return $this->document($request, $workflow->confirmPayment($webOrder, trim($data['reference']), $this->actor($request)));
    }

    /**
     * Start processing
     *
     * `confirmed` → `processing`.
     */
    public function process(Request $request, Order $webOrder, OrderWorkflow $workflow): JsonResponse
    {
        return $this->document($request, $workflow->process($webOrder, $this->actor($request)));
    }

    /**
     * Ship
     *
     * `{courier_id, tracking_number? (≤ 60), note? (≤ 200)}`: `processing` → `shipped` with an
     * active courier (else 422 on `courier_id`). Creates the shipment (`cod_amount` = the total
     * of an unpaid cash-on-delivery order, else 0) and its first event `handed_over`.
     */
    public function ship(Request $request, Order $webOrder, OrderWorkflow $workflow): JsonResponse
    {
        $data = $request->validate([
            'courier_id' => ['required', 'uuid'],
            'tracking_number' => ['sometimes', 'nullable', 'string', 'max:60'],
            'note' => ['sometimes', 'nullable', 'string', 'max:200'],
        ]);

        return $this->document($request, $workflow->ship($webOrder, $data['courier_id'], self::text($data, 'tracking_number'), self::text($data, 'note'), $this->actor($request)));
    }

    /**
     * Add a shipment event
     *
     * `{status: in_transit|delivered|returned, note? (≤ 200), occurred_at? (ISO date-time,
     * default now; not in the future, not before the hand-over)}`. `delivered` delivers the
     * order; `returned` (to the sender) lets an unpaid order be cancelled with restock.
     * 422 `SHIPMENT_NOT_FOUND` for orders without a courier shipment (not shipped, or shipped
     * before E10a), `INVALID_STATUS_TRANSITION` once the parcel is delivered or returned.
     */
    public function shipmentEvent(Request $request, Order $webOrder, OrderWorkflow $workflow): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', Rule::in([ShipmentStatus::InTransit->value, ShipmentStatus::Delivered->value, ShipmentStatus::Returned->value])],
            'note' => ['sometimes', 'nullable', 'string', 'max:200'],
            'occurred_at' => ['sometimes', 'nullable', 'date', function (string $attribute, mixed $value, Closure $fail) {
                if (is_string($value) && strtotime($value) !== false && CarbonImmutable::parse($value)->greaterThan(CarbonImmutable::now()->addMinutes(5))) {
                    $fail('The time of the update cannot be in the future.');
                }
            }],
        ]);
        $occurredAt = filled($data['occurred_at'] ?? null) ? CarbonImmutable::parse($data['occurred_at'])->utc() : null;

        return $this->document($request, $workflow->shipmentEvent($webOrder, ShipmentStatus::from($data['status']), self::text($data, 'note'), $occurredAt, $this->actor($request)));
    }

    /**
     * Mark processing (bulk)
     *
     * `{order_ids: [uuid, …] (1–100)}`: each confirmed order → processing on its own; never
     * all-or-nothing. Returns `{results: [{id, number, ok, error_code?, message?}], succeeded,
     * failed}` in the requested order (`NOT_FOUND` for ids that are not orders of this
     * organization, `INVALID_STATUS_TRANSITION` for orders that are not confirmed).
     */
    public function bulkProcess(Request $request, ProcessOrdersInBulk $process): JsonResponse
    {
        $data = $request->validate([
            'order_ids' => ['required', 'array', 'min:1', 'max:100'],
            'order_ids.*' => ['required', 'uuid'],
        ]);
        $results = $process($data['order_ids'], $this->actor($request));
        $succeeded = count(array_filter($results, fn (array $r) => $r['ok']));

        return ApiResponse::success(['results' => $results, 'succeeded' => $succeeded, 'failed' => count($results) - $succeeded]);
    }

    /**
     * Mark delivered
     *
     * `shipped` → `delivered`; the shipment (if any) gets a `delivered` event. A parcel
     * returned to the sender cannot be delivered (`INVALID_STATUS_TRANSITION`).
     */
    public function deliver(Request $request, Order $webOrder, OrderWorkflow $workflow): JsonResponse
    {
        return $this->document($request, $workflow->deliver($webOrder, $this->actor($request)));
    }

    /**
     * Record the cash-on-delivery payment
     *
     * For shipped or delivered COD orders once the courier remitted the money: records the
     * order total as `cash_on_delivery` in the payments ledger and marks the order paid.
     */
    public function recordCodPayment(Request $request, Order $webOrder, OrderWorkflow $workflow): JsonResponse
    {
        $data = $request->validate(['reference' => ['sometimes', 'nullable', 'string', 'max:80']]);

        return $this->document($request, $workflow->recordCodPayment($webOrder, filled($data['reference'] ?? null) ? trim($data['reference']) : null, $this->actor($request)));
    }

    /**
     * Cancel
     *
     * `{reason (≤ 200), refund?: {method: cash|bank_transfer|mobile_banking, reference? (≤ 80)}}`.
     * Orders that are not shipped yet, or shipped orders whose parcel was returned to the
     * sender (E10a); the stock goes back to the exact batches it came from. Unpaid orders need
     * `web_orders.manage` (`refund` is ignored). Paid orders (E11) need `web_orders.refund`
     * (else 403) and `refund` (else 422 `REFUND_REQUIRED`): everything paid and not yet
     * refunded (`cancel_refund_amount`) goes out through the payments ledger
     * (`online_order_refund`; cash from the user's open register session in the order's
     * branch: `CASH_SESSION_REQUIRED`, `INSUFFICIENT_CASH`), the order becomes cancelled and
     * `refunded`, and the customer is e-mailed. `INVALID_STATUS_TRANSITION` otherwise.
     */
    public function cancel(Request $request, Order $webOrder, CancelOrder $cancel): JsonResponse
    {
        $user = $request->user();
        if (! $user->can('web_orders.manage') && ! $user->can('web_orders.refund')) {
            throw new AuthorizationException;
        }
        $data = $request->validate([
            'reason' => ['required', 'string', 'max:200'],
            'refund' => ['sometimes', 'nullable', 'array'],
            'refund.method' => ['required_with:refund', Rule::enum(RefundMethod::class)],
            'refund.reference' => ['sometimes', 'nullable', 'string', 'max:80'],
        ]);

        if (! $webOrder->payment_status->isPaid()) {
            if (! $user->can('web_orders.manage')) {
                throw new AuthorizationException;
            }

            return $this->document($request, $cancel($webOrder, trim($data['reason']), $this->actor($request)));
        }

        if (! $user->can('web_orders.refund')) {
            throw new AuthorizationException;
        }
        if (empty($data['refund']['method'])) {
            throw new BusinessRuleViolation('REFUND_REQUIRED', "{$webOrder->number} is paid; choose how the money is refunded to cancel it.", [
                'refund_amount' => Decimal::round(Decimal::sub((string) $webOrder->paid_total, (string) $webOrder->refunded_total, 2), 2),
            ]);
        }

        return $this->document($request, $cancel->cancelWithRefund(
            $webOrder,
            trim($data['reason']),
            RefundMethod::from($data['refund']['method']),
            filled($data['refund']['reference'] ?? null) ? trim((string) $data['refund']['reference']) : null,
            $user,
        ));
    }

    private function document(Request $request, Order $webOrder): JsonResponse
    {
        return ApiResponse::success($this->presenter->staff($webOrder->fresh() ?? $webOrder, $request->user()->can('web_orders.manage'), $request->user()->can('web_orders.refund')));
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
