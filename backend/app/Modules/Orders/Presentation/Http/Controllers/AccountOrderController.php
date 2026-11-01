<?php

namespace App\Modules\Orders\Presentation\Http\Controllers;

use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\Orders\Application\Actions\CancelOwnOrder;
use App\Modules\Orders\Application\Actions\ReorderOwnOrder;
use App\Modules\Orders\Application\Queries\CustomerOrderHistory;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Presentation\Http\Support\OrderPresenter;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Validation\Rule;

/**
 * The signed-in customer's own orders (E9). Another customer's order, another store's order
 * and unknown numbers are 404; guests get 401.
 */
class AccountOrderController
{
    public function __construct(
        private readonly CustomerOrderHistory $history,
        private readonly OrderPresenter $presenter,
    ) {}

    /**
     * My orders
     *
     * Newest first, 10 per page. `status`: `open` (awaiting payment, confirmed, processing,
     * shipped), `delivered` or `cancelled`. Rows: `{number, placed_at, status, status_label,
     * payment_status, payment_method_label, item_count, total, currency, first_item: {name,
     * image_url}}`.
     */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'status' => ['sometimes', 'nullable', Rule::in(array_keys(CustomerOrderHistory::GROUPS))],
            'page' => ['sometimes', 'integer', 'min:1'],
        ]);
        $page = $this->history->page($this->customerId($request), $data['status'] ?? null, (int) ($data['page'] ?? 1));

        return ApiResponse::paginated($page, fn (Order $o) => new JsonResource($this->presenter->accountRow($o)))->header('Cache-Control', 'no-store');
    }

    /**
     * My order
     *
     * The order view of the confirmation page (lines with discounts, totals, promotions,
     * coupon, address, history, courier and tracking number, payment instructions) plus
     * `can_cancel`, `cancelled_at`, `cancel_reason` and per line `product_id`, `variant_id`,
     * `review` (`{id, rating, status}` or null) and `reviewable`.
     */
    public function show(Request $request, string $number): JsonResponse
    {
        $customerId = $this->customerId($request);

        return ApiResponse::success($this->presenter->account($this->history->find($customerId, $number), $customerId))->header('Cache-Control', 'no-store');
    }

    /**
     * Cancel my order
     *
     * `{reason?}` (at most 200 characters). Only while awaiting payment or confirmed and
     * unpaid; otherwise 422 `ORDER_NOT_CANCELLABLE` (`details.status`,
     * `details.payment_status`). Needs an `Idempotency-Key`; a retry returns the first answer.
     * The stock goes back, staff are notified and the shopper gets an e-mail. Returns the
     * order as `GET` shows it.
     */
    public function cancel(Request $request, string $number, CancelOwnOrder $cancel): JsonResponse
    {
        $data = $request->validate(['reason' => ['sometimes', 'nullable', 'string', 'max:200']]);
        $customerId = $this->customerId($request);
        $reason = filled($data['reason'] ?? null) ? trim($data['reason']) : null;

        $order = $cancel($this->history->find($customerId, $number), $customerId, $reason, $request->getSchemeAndHttpHost());

        return ApiResponse::success($this->presenter->account($order->fresh() ?? $order, $customerId));
    }

    /**
     * Buy again
     *
     * Adds every line's variant with the ordered quantity to the cart (today's prices).
     * Returns `{cart, added: [{variant_id, name, quantity}], skipped: [{name, reason:
     * unavailable|out_of_stock|limit}]}`.
     */
    public function reorder(Request $request, string $number, ReorderOwnOrder $reorder): JsonResponse
    {
        $customerId = $this->customerId($request);

        return ApiResponse::success($reorder($this->history->find($customerId, $number), $customerId));
    }

    private function customerId(Request $request): string
    {
        /** @var CustomerAccount $account */
        $account = $request->user('customer');

        return $account->customer_id;
    }
}
