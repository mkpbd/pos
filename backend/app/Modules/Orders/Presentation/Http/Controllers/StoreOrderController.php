<?php

namespace App\Modules\Orders\Presentation\Http\Controllers;

use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\Orders\Application\Queries\OrderTracking;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Presentation\Http\Support\OrderPresenter;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

class StoreOrderController
{
    /**
     * Order status
     *
     * The confirmation / status page of an order: guests pass the `token` they got when placing
     * it (or from the e-mail link); a signed-in customer sees their own orders without one.
     * Anything else — unknown number, wrong or missing token, someone else's order — is 404.
     */
    public function show(Request $request, string $number, OrderPresenter $presenter): JsonResponse
    {
        /** @var Order|null $order */
        $order = Order::query()->where('number', $number)->first();
        $token = $request->query('token');
        $account = Auth::guard('customer')->user();

        $owner = $order !== null && $account instanceof CustomerAccount && $order->customer_id !== null && $order->customer_id === $account->customer_id;
        $tokenMatches = $order !== null && $order->access_token_hash !== null && is_string($token) && $token !== ''
            && hash_equals($order->access_token_hash, hash('sha256', $token));

        if (! $owner && ! $tokenMatches) {
            throw new NotFoundHttpException;
        }

        return ApiResponse::success($presenter->storefront($order))->header('Cache-Control', 'no-store');
    }

    /**
     * Track an order
     *
     * BD1a, without an account: `?number=WEB-000123&phone=01712345678` (any case; the phone in any
     * usual Bangladeshi format) → the store's order whose contact or delivery mobile number is
     * that phone: `{number, status, payment_method, payment_status, placed_at, total, currency,
     * item_count, history: [{status, at}], shipment: {courier_name, tracking_number,
     * tracking_url, status} | null}` — no name, address, lines or e-mail. Unknown number or
     * another phone → 404 `ORDER_NOT_FOUND` (the same answer). 10 lookups a minute per IP.
     */
    public function track(Request $request, OrderTracking $tracking, OrderPresenter $presenter): JsonResponse
    {
        $data = $request->validate([
            'number' => ['required', 'string', 'max:40'],
            'phone' => ['required', 'string', 'max:30'],
        ]);

        return ApiResponse::success($presenter->tracking($tracking->find($data['number'], $data['phone'])))->header('Cache-Control', 'no-store');
    }
}
