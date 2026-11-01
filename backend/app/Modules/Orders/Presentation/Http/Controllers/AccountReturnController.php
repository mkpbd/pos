<?php

namespace App\Modules\Orders\Presentation\Http\Controllers;

use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\Orders\Application\Actions\OrderReturnWorkflow;
use App\Modules\Orders\Application\Queries\CustomerOrderHistory;
use App\Modules\Orders\Domain\ReturnReason;
use App\Modules\Orders\Infrastructure\Models\OrderReturn;
use App\Modules\Orders\Presentation\Http\Support\ReturnPresenter;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Validation\Rule;

/**
 * The signed-in customer's own returns (E10b). Another customer's order or return, another
 * store's and unknown numbers are 404; guests get 401.
 */
class AccountReturnController
{
    public function __construct(
        private readonly CustomerOrderHistory $orders,
        private readonly ReturnPresenter $presenter,
    ) {}

    /**
     * My returns
     *
     * Newest first, 10 per page (`meta.pagination`): the return view (`number, order_number, order {number}, status,
     * status_label, reason_code, reason_label, note, rejection_reason, lines [{order_line_id,
     * product_name, variant_name, sku, image_url, quantity, requested_quantity, amount}],
     * items_amount, shipping_refund, refund_amount, currency, refund_method,
     * refund_method_label, refunded_at, can_cancel, created_at`).
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate(['page' => ['sometimes', 'integer', 'min:1']]);
        $page = $this->own($request)->with(['order', 'lines.orderLine'])
            ->orderByDesc('created_at')->orderByDesc('id')
            ->paginate(10, ['*'], 'page', max(1, (int) $request->query('page', 1)));

        return ApiResponse::paginated($page, fn (OrderReturn $r) => new JsonResource($this->presenter->customer($r)))->header('Cache-Control', 'no-store');
    }

    /**
     * Return items of my order
     *
     * `{reason_code: damaged|wrong_item|not_as_described|changed_mind|other, note? (≤ 500),
     * lines: [{order_line_id, quantity}] (1–50)}`. Needs an `Idempotency-Key`; a retry returns
     * the first answer. 201 with the return. 422 `RETURN_NOT_ALLOWED` (`details.reason`:
     * `not_delivered`, `not_paid`, `returns_disabled`, `window_closed`),
     * `QUANTITY_EXCEEDS_RETURNABLE` (`details.lines: [{order_line_id, product_name,
     * requested, returnable}]`), `VALIDATION_FAILED` (unknown or repeated lines, quantity).
     */
    public function store(Request $request, string $number, OrderReturnWorkflow $workflow): JsonResponse
    {
        $data = $request->validate(self::rules());
        $order = $this->orders->find($this->customerId($request), $number);
        $return = $workflow->request($order, $data, 'customer', null);

        return ApiResponse::created($this->presenter->customer($return->fresh() ?? $return));
    }

    /**
     * Cancel my return request
     *
     * Only while `requested` (else 422 `RETURN_NOT_CANCELLABLE`, `details.status`). Needs an
     * `Idempotency-Key`. Returns the return.
     */
    public function cancel(Request $request, string $number, OrderReturnWorkflow $workflow): JsonResponse
    {
        /** @var OrderReturn $return */
        $return = $this->own($request)->where('number', $number)->firstOrFail();
        $cancelled = $workflow->cancelByCustomer($return);

        return ApiResponse::success($this->presenter->customer($cancelled->fresh() ?? $cancelled));
    }

    /**
     * @return array<string, mixed>
     */
    public static function rules(): array
    {
        return [
            'reason_code' => ['required', Rule::enum(ReturnReason::class)],
            'note' => ['sometimes', 'nullable', 'string', 'max:500'],
            'lines' => ['required', 'array', 'min:1', 'max:50'],
            'lines.*.order_line_id' => ['required', 'uuid'],
            'lines.*.quantity' => ['required', 'numeric', 'gt:0', 'max:99999', 'decimal:0,3'],
        ];
    }

    /**
     * @return Builder<OrderReturn>
     */
    private function own(Request $request): Builder
    {
        $customerId = $this->customerId($request);

        return OrderReturn::query()->whereHas('order', fn (Builder $q) => $q->where('customer_id', $customerId));
    }

    private function customerId(Request $request): string
    {
        /** @var CustomerAccount $account */
        $account = $request->user('customer');

        return $account->customer_id;
    }
}
