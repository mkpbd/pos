<?php

namespace App\Modules\Orders\Presentation\Http\Controllers;

use App\Modules\Orders\Application\Actions\PaymentClaimWorkflow;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Presentation\Http\Support\OrderPresenter;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * BD1c: staff review the shopper's Send Money payment claims. Needs `web_orders.manage` and an
 * `Idempotency-Key`; returns the full order (as `GET web-orders/{id}`).
 */
class WebOrderPaymentClaimController
{
    public function __construct(private readonly OrderPresenter $presenter) {}

    /**
     * Confirm a payment claim
     *
     * The money arrived (checked in the wallet app): the claim is confirmed, its amount goes into
     * the payments ledger as `mobile_banking` ("bKash TrxID … from …", no drawer), `paid_total`
     * grows, the order becomes `paid` — or `partially_paid` after a COD order's advance — and
     * `pending_payment` → `confirmed`. 422 `INVALID_STATUS_TRANSITION` unless the claim is
     * `submitted`; 422 `PAYMENT_NOT_DUE` when the order no longer owes the payment (cancelled…).
     */
    public function confirm(Request $request, Order $webOrder, string $claim, PaymentClaimWorkflow $claims): JsonResponse
    {
        return $this->document($request, $claims->confirm($webOrder, $claim, $this->actor($request)));
    }

    /**
     * Reject a payment claim
     *
     * `{reason}` (required, ≤ 200; shown to the shopper). The order is unchanged (still awaiting
     * payment, same expiry); the shopper may report another transaction. 422
     * `INVALID_STATUS_TRANSITION` unless the claim is `submitted`.
     */
    public function reject(Request $request, Order $webOrder, string $claim, PaymentClaimWorkflow $claims): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:200']]);

        return $this->document($request, $claims->reject($webOrder, $claim, trim($data['reason']), $this->actor($request)));
    }

    private function document(Request $request, Order $order): JsonResponse
    {
        $user = $request->user();

        return ApiResponse::success($this->presenter->staff($order->fresh() ?? $order, $user->can('web_orders.manage'), $user->can('web_orders.refund'), $user->can('web_orders.edit')));
    }

    private function actor(Request $request): string
    {
        return (string) $request->user()->getAuthIdentifier();
    }
}
