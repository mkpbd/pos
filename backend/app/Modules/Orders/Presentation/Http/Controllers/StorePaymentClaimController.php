<?php

namespace App\Modules\Orders\Presentation\Http\Controllers;

use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\Orders\Application\Actions\PaymentClaimWorkflow;
use App\Modules\Orders\Application\Queries\OrderTracking;
use App\Modules\Orders\Domain\OrderPaymentMethod;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Presentation\Http\Support\OrderPresenter;
use App\Modules\Shared\Domain\BangladeshMobile;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rule;

/**
 * BD1c: the shopper reports a Send Money payment (sender number and transaction ID).
 */
class StorePaymentClaimController
{
    /**
     * Report a Send Money payment
     *
     * `{method: bkash_manual|nagad_manual|rocket_manual, sender_phone, transaction_id, token?,
     * phone?}` after sending the order's `payment_due.amount` to the shop's number. Access as on
     * the order page — the signed-in owner or the guest `token` — or, from the track page, the
     * order's contact or delivery mobile number as `phone`; anything else → 404
     * `ORDER_NOT_FOUND`. Errors: 422 `PAYMENT_NOT_DUE` (nothing to pay now), 422 on `method`
     * (not offered for this payment), 409 `PAYMENT_CLAIM_PENDING` (a claim is already being
     * checked), 422 `TRANSACTION_ID_USED`, field errors. The TrxID is stored upper-cased
     * (6–40 letters and digits). Needs an `Idempotency-Key`. 201 → the order as `GET
     * store/orders/{number}` shows it (with `payment_due.claim`) — from the track page (`phone`)
     * the track view instead.
     */
    public function store(Request $request, string $number, PaymentClaimWorkflow $claims, OrderTracking $tracking, OrderPresenter $presenter): JsonResponse
    {
        $phone = $request->input('sender_phone');
        if (is_string($phone) && trim($phone) !== '') {
            $request->merge(['sender_phone' => BangladeshMobile::normalize($phone) ?? $phone]);
        }
        $data = $request->validate([
            'method' => ['required', 'string', Rule::in(array_map(fn (OrderPaymentMethod $m) => $m->value, OrderPaymentMethod::sendMoney()))],
            'sender_phone' => ['required', 'string', 'regex:'.BangladeshMobile::PATTERN],
            'transaction_id' => ['required', 'string', 'max:60'],
            'token' => ['sometimes', 'nullable', 'string', 'max:200'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:30'],
        ], [
            'sender_phone.regex' => 'Enter the Bangladeshi mobile number you sent the money from, e.g. 01712345678.',
        ]);

        [$order, $viaPhone] = $this->accessible($number, $data['token'] ?? null, $data['phone'] ?? null, $tracking);
        $claims->submit($order, $data['method'], $data['sender_phone'], $data['transaction_id'], $request->ip());
        $fresh = $order->fresh() ?? $order;

        return ApiResponse::created($viaPhone ? $presenter->tracking($fresh) : $presenter->storefront($fresh))->header('Cache-Control', 'no-store');
    }

    /**
     * @return array{0: Order, 1: bool} the order and whether it was opened with the phone (track page)
     *
     * @throws BusinessRuleViolation ORDER_NOT_FOUND (404)
     */
    private function accessible(string $number, ?string $token, ?string $phone, OrderTracking $tracking): array
    {
        /** @var Order|null $order */
        $order = Order::query()->where('number', $number)->first();
        $account = Auth::guard('customer')->user();
        $owner = $order !== null && $account instanceof CustomerAccount && $order->customer_id !== null && $order->customer_id === $account->customer_id;
        $tokenMatches = $order !== null && $order->access_token_hash !== null && is_string($token) && $token !== ''
            && hash_equals($order->access_token_hash, hash('sha256', $token));
        if ($order !== null && ($owner || $tokenMatches)) {
            return [$order, false];
        }
        if (is_string($phone) && trim($phone) !== '') {
            return [$tracking->find($number, $phone), true];
        }

        throw new BusinessRuleViolation('ORDER_NOT_FOUND', 'We could not find this order.', [], 404);
    }
}
