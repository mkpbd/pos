<?php

namespace App\Modules\Orders\Presentation\Http\Controllers;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Orders\Application\Actions\CancelOrder;
use App\Modules\Orders\Application\Actions\OrderWorkflow;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Domain\PaymentStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Presentation\Http\Support\OrderPresenter;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

/**
 * Web orders for staff: list, detail and the workflow steps. Viewing needs
 * `web_orders.view`; every step needs `web_orders.manage` and an `Idempotency-Key`, and
 * returns the full order.
 */
class WebOrderController
{
    public function __construct(private readonly OrderPresenter $presenter) {}

    /**
     * Web orders
     *
     * Filters: `status`, `payment_status`, `from`/`to` (calendar days in the organization's
     * timezone); `search` matches number, contact name, phone and e-mail. Newest first.
     * Rows: `{id, number, placed_at, status, status_label, payment_status, payment_method,
     * contact_name, contact_phone, total, currency, item_count}`.
     */
    public function index(Request $request, OrganizationDirectory $organizations, TenantContext $tenant): JsonResponse
    {
        $request->validate([
            'status' => ['sometimes', Rule::enum(OrderStatus::class)],
            'payment_status' => ['sometimes', Rule::enum(PaymentStatus::class)],
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
        ]);
        $timezone = $organizations->summary($tenant->requireOrganization())['timezone'] ?? config('app.timezone');
        $day = fn (string $date) => Carbon::parse($date, $timezone)->startOfDay()->setTimezone(config('app.timezone'));

        $query = Order::query()
            ->withSum('lines', 'quantity')
            ->when($request->query('status'), fn (Builder $q, string $v) => $q->where('status', $v))
            ->when($request->query('payment_status'), fn (Builder $q, string $v) => $q->where('payment_status', $v))
            ->when($request->query('from'), fn (Builder $q, string $v) => $q->where('placed_at', '>=', $day($v)))
            ->when($request->query('to'), fn (Builder $q, string $v) => $q->where('placed_at', '<', $day($v)->addDay()));

        $page = ListQuery::paginate($query, $request, sortable: ['placed_at', 'number', 'total'], searchable: ['number', 'contact_name', 'contact_phone', 'contact_email'], defaultSort: '-placed_at');

        return ApiResponse::paginated($page, fn (Order $o) => new JsonResource(OrderPresenter::row($o, Decimal::round((string) ($o->getAttribute('lines_sum_quantity') ?? '0'), 3))));
    }

    /**
     * Web order
     *
     * The order view the shopper sees plus `id`, `customer` (`{id, name, code}` or null for
     * guests), `ip`, `user_agent`, `notes`, cancellation, status history with actor names,
     * `payments` (`[{method, amount, reference, recorded_at, recorded_by}]`) and
     * `allowed_actions` (subset of confirm_payment, process, ship, deliver, record_cod_payment,
     * cancel; empty without `web_orders.manage`).
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
     * `processing` → `shipped`, recording the courier and tracking number.
     */
    public function ship(Request $request, Order $webOrder, OrderWorkflow $workflow): JsonResponse
    {
        $data = $request->validate([
            'courier_name' => ['required', 'string', 'max:100'],
            'tracking_number' => ['sometimes', 'nullable', 'string', 'max:100'],
        ]);

        return $this->document($request, $workflow->ship($webOrder, trim($data['courier_name']), filled($data['tracking_number'] ?? null) ? trim($data['tracking_number']) : null, $this->actor($request)));
    }

    /**
     * Mark delivered
     *
     * `shipped` → `delivered`.
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
     * Unpaid orders that are not shipped yet; the stock goes back to the exact batches it came
     * from. `ORDER_PAID` for paid orders, `INVALID_STATUS_TRANSITION` otherwise.
     */
    public function cancel(Request $request, Order $webOrder, CancelOrder $cancel): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:200']]);

        return $this->document($request, $cancel($webOrder, trim($data['reason']), $this->actor($request)));
    }

    private function document(Request $request, Order $webOrder): JsonResponse
    {
        return ApiResponse::success($this->presenter->staff($webOrder->fresh() ?? $webOrder, $request->user()->can('web_orders.manage')));
    }

    private function actor(Request $request): string
    {
        return (string) $request->user()->getAuthIdentifier();
    }
}
