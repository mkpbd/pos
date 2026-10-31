<?php

namespace App\Modules\Orders\Presentation\Http\Controllers;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Cart\Application\Actions\ShoppingCart;
use App\Modules\Cart\Presentation\Http\Support\CartCookie;
use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\OnlinePayments\Application\Contracts\CheckoutPaymentMethods;
use App\Modules\Orders\Application\Actions\PlaceOrder;
use App\Modules\Orders\Application\Services\CheckoutQuoter;
use App\Modules\Orders\Presentation\Http\Support\OrderPresenter;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\BangladeshMobile;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rule;

/**
 * Storefront checkout (E8a): what is possible, a live price preview, and placing the order.
 * Works for signed-in customers and, when the store allows it, guests.
 */
class StoreCheckoutController
{
    public function __construct(
        private readonly StorefrontConfig $storefront,
        private readonly ShoppingCart $carts,
        private readonly CheckoutQuoter $quoter,
    ) {}

    /**
     * Checkout options
     *
     * `available` is false with `reason` `no_fulfilment_store` (online ordering is switched off)
     * or `cart_empty`. `guest_checkout` false = guests must sign in. Payment instructions are
     * only shown after placing the order (`instructions_preview` is always null).
     */
    public function options(Request $request, CheckoutPaymentMethods $payments, BranchDirectory $branches, TenantContext $tenant): JsonResponse
    {
        $settings = $this->storefront->settings();
        $storeId = $settings->fulfilment_store_id;
        $store = $storeId === null ? null : $branches->store($storeId, $tenant->requireOrganization());
        $cart = $this->carts->find(CartCookie::owner($request));

        $reason = match (true) {
            $store === null || ! $store['is_active'] || ! $store['branch_is_active'] => 'no_fulfilment_store',
            $cart === null || ! $cart->items()->exists() => 'cart_empty',
            default => null,
        };

        return ApiResponse::success([
            'available' => $reason === null,
            'reason' => $reason,
            'guest_checkout' => $settings->guest_checkout_enabled,
            'payment_methods' => array_map(fn (array $m) => [
                'code' => $m['code'],
                'display_name' => $m['display_name'],
                'instructions_preview' => null,
            ], $payments->enabled()),
            'signed_in' => $this->account() !== null,
        ]);
    }

    /**
     * Checkout preview
     *
     * The order as it would be placed now (same body as placing, any subset): cart lines,
     * subtotal, VAT, delivery fee (`shipping_methods` for the address's district, the chosen
     * `shipping_method_id` or null), COD fee and total. `payment_method` is null when the
     * chosen method cannot be used. `issues` are the cart's (`unavailable`, `out_of_stock`,
     * `exceeds_stock`). Errors: `CART_EMPTY`, `CHECKOUT_UNAVAILABLE`.
     */
    public function preview(Request $request, BranchDirectory $branches, TenantContext $tenant): JsonResponse
    {
        $data = $request->validate([
            'shipping_address_id' => ['sometimes', 'nullable', 'uuid'],
            'address' => ['sometimes', 'nullable', 'array'],
            'address.division_id' => ['sometimes', 'nullable', 'integer'],
            'address.district_id' => ['sometimes', 'nullable', 'integer'],
            'shipping_method_id' => ['sometimes', 'nullable', 'uuid'],
            'payment_method' => ['sometimes', 'nullable', 'string', 'max:30'],
        ]);

        $storeId = $this->storefront->settings()->fulfilment_store_id;
        $store = $storeId === null ? null : $branches->store($storeId, $tenant->requireOrganization());
        if ($store === null || ! $store['is_active'] || ! $store['branch_is_active']) {
            throw new BusinessRuleViolation('CHECKOUT_UNAVAILABLE', 'Online ordering is not available right now. Please try again later.', ['reason' => 'no_fulfilment_store']);
        }
        $cart = $this->carts->find(CartCookie::owner($request));
        if ($cart === null || ! $cart->items()->exists()) {
            throw new BusinessRuleViolation('CART_EMPTY', 'Your cart is empty.');
        }

        return ApiResponse::success($this->quoter->quote($cart, $data, $this->account()?->customer_id, autoPickMethod: true)['preview']);
    }

    /**
     * Place the order
     *
     * Header `Idempotency-Key` required (one per attempt; a retry with the same key returns
     * the first answer). `expected_total` is the total the shopper confirmed: if the server
     * total differs → 409 `TOTAL_CHANGED` with `details.preview`. Customers send
     * `shipping_address_id` or `address` (+ `save_address`); guests send `address`.
     * Phones: Bangladeshi mobile numbers (stored as 01XXXXXXXXX).
     *
     * 201 `{order, access_token}` — the token (guests only; null for customers) opens
     * `/order/{number}?token=…`; it is shown only here and in the confirmation e-mail.
     * Errors: `CART_EMPTY`, `CART_HAS_ISSUES` (details.cart), `CHECKOUT_UNAVAILABLE`,
     * `SHIPPING_UNAVAILABLE`, `PAYMENT_METHOD_UNAVAILABLE`, `INSUFFICIENT_STOCK`,
     * `GUEST_CHECKOUT_DISABLED`, `TOTAL_CHANGED` (409), field errors.
     */
    public function place(Request $request, PlaceOrder $place, OrderPresenter $presenter): JsonResponse
    {
        $account = $this->account();
        foreach (['contact.phone', 'address.phone'] as $field) {
            $phone = $request->input($field);
            if (is_string($phone) && trim($phone) !== '') {
                $request->merge([explode('.', $field)[0] => array_replace((array) $request->input(explode('.', $field)[0]), ['phone' => BangladeshMobile::normalize($phone) ?? $phone])]);
            }
        }

        $useSaved = $account !== null && filled($request->input('shipping_address_id'));
        $addressRule = $useSaved ? 'sometimes' : 'required';
        $mobile = ['string', 'regex:'.BangladeshMobile::PATTERN];
        $data = $request->validate([
            'contact' => ['required', 'array'],
            'contact.name' => ['required', 'string', 'max:120'],
            'contact.email' => ['required', 'string', 'email', 'max:255'],
            'contact.phone' => ['required', ...$mobile],
            'shipping_address_id' => [$account === null ? 'prohibited' : 'sometimes', 'nullable', 'uuid'],
            'address' => [$addressRule, 'array'],
            'address.recipient_name' => [$addressRule, 'string', 'max:120'],
            'address.phone' => [$addressRule, ...$mobile],
            'address.division_id' => [$addressRule, 'integer', 'exists:geo_divisions,id'],
            'address.district_id' => [$addressRule, 'integer', 'exists:geo_districts,id'],
            'address.area' => ['sometimes', 'nullable', 'string', 'max:100'],
            'address.address_line' => [$addressRule, 'string', 'max:255'],
            'address.postcode' => ['sometimes', 'nullable', 'string', 'regex:/^\d{4}$/'],
            'save_address' => ['sometimes', 'boolean'],
            'shipping_method_id' => ['required', 'uuid'],
            'payment_method' => ['required', 'string', Rule::in(['cod', 'bank_transfer'])],
            'notes' => ['sometimes', 'nullable', 'string', 'max:500'],
            'expected_total' => ['required', 'numeric', 'min:0', 'decimal:0,2'],
        ], [
            'contact.phone.regex' => 'Enter a Bangladeshi mobile number, e.g. 01712345678.',
            'address.phone.regex' => 'Enter a Bangladeshi mobile number, e.g. 01712345678.',
        ]);
        if ($useSaved) {
            unset($data['address']);
        }
        $data['contact'] = array_map('trim', $data['contact']);
        $data['save_address'] = $request->boolean('save_address');
        $data['notes'] = filled($data['notes'] ?? null) ? trim($data['notes']) : null;
        foreach (['recipient_name', 'area', 'address_line', 'postcode'] as $key) {
            if (isset($data['address'][$key]) && is_string($data['address'][$key])) {
                $data['address'][$key] = trim($data['address'][$key]) === '' ? null : trim($data['address'][$key]);
            }
        }

        $result = $place(
            CartCookie::owner($request),
            $account === null ? null : ['customer_id' => $account->customer_id, 'account_id' => $account->id],
            $data,
            ['ip' => $request->ip(), 'user_agent' => $request->userAgent(), 'site_url' => $request->getSchemeAndHttpHost()],
        );

        $response = ApiResponse::created([
            'order' => $presenter->storefront($result['order']),
            'access_token' => $result['access_token'],
        ]);

        return $account === null ? $response->withCookie(CartCookie::forget($request)) : $response;
    }

    private function account(): ?CustomerAccount
    {
        $account = Auth::guard('customer')->user();

        return $account instanceof CustomerAccount ? $account : null;
    }
}
