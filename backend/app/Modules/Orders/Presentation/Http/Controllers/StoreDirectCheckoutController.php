<?php

namespace App\Modules\Orders\Presentation\Http\Controllers;

use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\Orders\Application\Actions\PlaceDirectOrder;
use App\Modules\Orders\Application\Services\CheckoutPhoneCheck;
use App\Modules\Orders\Application\Services\CodAdvancePolicy;
use App\Modules\Orders\Application\Services\CodRiskPolicy;
use App\Modules\Orders\Domain\OrderPaymentMethod;
use App\Modules\Orders\Presentation\Http\Support\CheckoutVerifiedPhones;
use App\Modules\Orders\Presentation\Http\Support\OrderPresenter;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\BangladeshMobile;
use App\Modules\Shared\Domain\ClickIds;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rule;

/**
 * P2a: the one-product order page — a landing page's `order_form` element orders directly,
 * without the cart (guests and customers, like the checkout).
 */
class StoreDirectCheckoutController
{
    private const ELEMENT_ID = '/^[a-z][a-z0-9_-]{1,31}$/';

    /**
     * Order form preview
     *
     * The order summary for the form's lines, recomputed by the server: `{document_id,
     * element_id, lines: [{variant_id, quantity}], address?: {district_id}, shipping_method_id?,
     * payment_method?}` → the checkout preview shape (lines, subtotal, discount_total, tax_total,
     * shipping_total, shipping_discount, cod_fee, total, currency, shipping_methods for the
     * district, shipping_method_id, payment_method, promotions, issues). Coupons do not apply.
     * Errors: `ORDER_FORM_UNAVAILABLE`, `CHECKOUT_UNAVAILABLE`, field errors on `lines`.
     * BD1b: optional `contact: {phone}` → `cod_available` false for a blocked number (cash on
     * delivery then unusable: `payment_method` null, no COD fee); true otherwise.
     * BD1c: `cod_advance` (`{amount, methods}` or null) as in the checkout preview.
     */
    public function preview(Request $request, PlaceDirectOrder $direct, CodRiskPolicy $codRisk, CodAdvancePolicy $codAdvance): JsonResponse
    {
        $data = $request->validate([
            ...$this->formRules(),
            // BD1b: the mobile number, for `cod_available`.
            'contact' => ['sometimes', 'nullable', 'array'],
            'contact.phone' => ['sometimes', 'nullable', 'string', 'max:30'],
            'address' => ['sometimes', 'nullable', 'array'],
            'address.district_id' => ['sometimes', 'nullable', 'integer'],
            // BD2a: the delivery area (prices the delivery).
            'address.area_id' => ['sometimes', 'nullable', 'uuid'],
            'shipping_method_id' => ['sometimes', 'nullable', 'uuid'],
            'payment_method' => ['sometimes', 'nullable', 'string', Rule::in(OrderPaymentMethod::values())],
        ]);
        $phones = [$data['contact']['phone'] ?? null];

        // BD1c: `cod_advance` as in the checkout preview.
        return ApiResponse::success($codAdvance->preview($codRisk->preview($direct->preview($data, $this->account()?->customer_id), $phones), $phones));
    }

    /**
     * Place an order from an order form
     *
     * Header `Idempotency-Key` required (a retry with the same key returns the first answer).
     * `{document_id, element_id, lines, contact: {name, phone, email?}, address: {district_id,
     * division_id?, area?, area_id?, address_line, postcode?}, shipping_method_id, payment_method, note?,
     * expected_total, attribution?}`. The shopper's cart is not touched. 201 `{order,
     * access_token, order_url}`. Errors: `ORDER_FORM_UNAVAILABLE`, `ITEMS_UNAVAILABLE`,
     * `CHECKOUT_UNAVAILABLE`, `SHIPPING_UNAVAILABLE`, `PAYMENT_METHOD_UNAVAILABLE`,
     * `INSUFFICIENT_STOCK`, `GUEST_CHECKOUT_DISABLED`, `TOTAL_CHANGED` (409), field errors,
     * BD1b `COD_NOT_AVAILABLE` (cash on delivery to a blocked number).
     * BD1a: the store's phone check applies as at checkout — `PHONE_NOT_VERIFIED` (422,
     * `details.phone`) unless the number is the account's verified one or was checked with
     * `checkout/phone/verify` in this session.
     */
    public function place(Request $request, PlaceDirectOrder $direct, OrderPresenter $presenter, CheckoutPhoneCheck $phoneCheck, TenantContext $tenant): JsonResponse
    {
        $phone = $request->input('contact.phone');
        if (is_string($phone) && trim($phone) !== '') {
            $request->merge(['contact' => array_replace((array) $request->input('contact'), ['phone' => BangladeshMobile::normalize($phone) ?? $phone])]);
        }

        $data = $request->validate([
            ...$this->formRules(),
            'contact' => ['required', 'array'],
            'contact.name' => ['required', 'string', 'max:120'],
            'contact.phone' => ['required', 'string', 'regex:'.BangladeshMobile::PATTERN],
            'contact.email' => ['sometimes', 'nullable', 'string', 'email', 'max:255'],
            'address' => ['required', 'array'],
            'address.district_id' => ['required', 'integer', 'exists:geo_districts,id'],
            'address.division_id' => ['sometimes', 'nullable', 'integer', 'exists:geo_divisions,id'],
            'address.area' => ['sometimes', 'nullable', 'string', 'max:100'],
            // BD2a: a delivery area of the district — required when the district has active areas.
            'address.area_id' => ['sometimes', 'nullable', 'uuid'],
            'address.address_line' => ['required', 'string', 'max:255'],
            'address.postcode' => ['sometimes', 'nullable', 'string', 'regex:/^\d{4}$/'],
            'shipping_method_id' => ['required', 'uuid'],
            'payment_method' => ['required', 'string', Rule::in(OrderPaymentMethod::values())],
            'note' => ['sometimes', 'nullable', 'string', 'max:500'],
            'expected_total' => ['required', 'numeric', 'min:0', 'decimal:0,2'],
            // Sanitized by the action (invalid parts dropped, never an error).
            'attribution' => ['sometimes', 'nullable'],
        ], [
            'contact.phone.regex' => 'Enter a Bangladeshi mobile number, e.g. 01712345678.',
        ]);

        $account = $this->account();
        // BD1a: before any stock or locking work.
        $phoneCheck->ensure((string) $data['contact']['phone'], (string) $data['payment_method'], fn () => CheckoutVerifiedPhones::forShopper($request, $tenant->requireOrganization(), $account));

        $result = $direct->place(
            $data,
            $account === null ? null : ['customer_id' => $account->customer_id, 'account_id' => $account->id],
            // BD1c: the ad click ids (pixel cookies, click ids of the attribution).
            ['ip' => $request->ip(), 'user_agent' => $request->userAgent(), 'site_url' => $request->getSchemeAndHttpHost(),
                'tracking_ids' => ClickIds::collect($request->cookies->all(), $request->input('attribution'), (int) now()->getTimestampMs())],
        );
        $number = $result['order']->number;

        return ApiResponse::created([
            'order' => $presenter->storefront($result['order']),
            'access_token' => $result['access_token'],
            'order_url' => '/order/'.$number.($result['access_token'] === null ? '' : '?token='.$result['access_token']),
        ]);
    }

    /**
     * @return array<string, list<mixed>>
     */
    private function formRules(): array
    {
        return [
            'document_id' => ['required', 'uuid'],
            'element_id' => ['required', 'string', 'regex:'.self::ELEMENT_ID],
            'lines' => ['required', 'array', 'min:1', 'max:2'],
            'lines.*' => ['required', 'array'],
            'lines.*.variant_id' => ['required', 'uuid'],
            'lines.*.quantity' => ['required', 'numeric', 'gt:0', 'max:999'],
        ];
    }

    private function account(): ?CustomerAccount
    {
        $account = Auth::guard('customer')->user();

        return $account instanceof CustomerAccount ? $account : null;
    }
}
