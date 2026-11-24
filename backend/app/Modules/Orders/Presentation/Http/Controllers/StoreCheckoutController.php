<?php

namespace App\Modules\Orders\Presentation\Http\Controllers;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Cart\Application\Actions\ShoppingCart;
use App\Modules\Cart\Presentation\Http\Support\CartCookie;
use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\OnlinePayments\Application\Contracts\CheckoutPaymentMethods;
use App\Modules\Orders\Application\Actions\PlaceOrder;
use App\Modules\Orders\Application\Services\CheckoutPhoneCheck;
use App\Modules\Orders\Application\Services\CheckoutQuoter;
use App\Modules\Orders\Application\Services\CodRiskPolicy;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Presentation\Http\Support\CheckoutVerifiedPhones;
use App\Modules\Orders\Presentation\Http\Support\OrderPresenter;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\BangladeshMobile;
use App\Modules\Shared\Domain\CampaignAttribution;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Queries\CheckoutContact;
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
        private readonly CheckoutContact $contact,
    ) {}

    /**
     * Checkout options
     *
     * `available` is false with `reason` `no_fulfilment_store` (online ordering is switched off)
     * or `cart_empty`. `guest_checkout` false = guests must sign in. Payment instructions are
     * only shown after placing the order (`instructions_preview` is always null).
     * BD1a: `email_field` required | optional | hidden (the customer e-mail field),
     * `phone_verification` off | cod | all (which orders need the mobile number checked with an
     * SMS code first — off while SMS cannot send codes) and `phone_login` (sign-in with a code).
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
            'email_field' => $this->contact->emailMode(),
            'phone_verification' => $this->contact->phoneVerification(),
            'phone_login' => $this->contact->phoneLogin(),
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
     * BD1a: `contact` {email?, phone?} (optional) lets per-customer promotion limits count
     * the shopper's earlier orders by e-mail and mobile number, as placing the order will.
     * BD1b: `cod_available` (bool) — false when `contact.phone`, `address.phone` or the saved
     * address's phone is a blocked number; cash on delivery is then unusable (`payment_method`
     * null, no COD fee) and placing the order with it → 422 `COD_NOT_AVAILABLE`.
     */
    public function preview(Request $request, BranchDirectory $branches, TenantContext $tenant, CodRiskPolicy $codRisk): JsonResponse
    {
        $data = $request->validate([
            'contact' => ['sometimes', 'nullable', 'array'],
            'contact.email' => ['sometimes', 'nullable', 'string', 'max:255'],
            'contact.phone' => ['sometimes', 'nullable', 'string', 'max:30'],
            'shipping_address_id' => ['sometimes', 'nullable', 'uuid'],
            'address' => ['sometimes', 'nullable', 'array'],
            'address.division_id' => ['sometimes', 'nullable', 'integer'],
            'address.district_id' => ['sometimes', 'nullable', 'integer'],
            'address.phone' => ['sometimes', 'nullable', 'string', 'max:30'],
            'shipping_method_id' => ['sometimes', 'nullable', 'uuid'],
            'payment_method' => ['sometimes', 'nullable', 'string', 'max:30'],
        ]);
        if ($this->contact->emailMode() === 'hidden') {
            unset($data['contact']['email']);
        }

        $storeId = $this->storefront->settings()->fulfilment_store_id;
        $store = $storeId === null ? null : $branches->store($storeId, $tenant->requireOrganization());
        if ($store === null || ! $store['is_active'] || ! $store['branch_is_active']) {
            throw new BusinessRuleViolation('CHECKOUT_UNAVAILABLE', 'Online ordering is not available right now. Please try again later.', ['reason' => 'no_fulfilment_store']);
        }
        $cart = $this->carts->find(CartCookie::owner($request));
        if ($cart === null || ! $cart->items()->exists()) {
            throw new BusinessRuleViolation('CART_EMPTY', 'Your cart is empty.');
        }

        $quote = $this->quoter->quote($cart, $data, $this->account()?->customer_id, autoPickMethod: true);

        // BD1b: `cod_available` false when the contact, delivery or saved-address phone is blocked.
        return ApiResponse::success($codRisk->preview($quote['preview'], [$data['contact']['phone'] ?? null, $data['address']['phone'] ?? null, $quote['saved_address']['phone'] ?? null]));
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
     * `GUEST_CHECKOUT_DISABLED`, `TOTAL_CHANGED` (409), field errors; BD1b: `COD_NOT_AVAILABLE`
     * (cash on delivery to a blocked number). A COD order may start `pending_confirmation`
     * (the store's `cod_review`: staff call to confirm it).
     *
     * P2a: `attribution` (optional) — the campaign the shopper came from (UTM parameters,
     * short link, first landing path, referrer host); sanitized and stored on the order.
     *
     * BD1a: `contact.email` follows the store's `email_field` — required, optional (null or
     * omitted) or hidden (ignored, stored null). When the store checks phones
     * (`phone_verification` `all`, or `cod` with cash on delivery) `contact.phone` must be the
     * signed-in account's verified number or one checked with `checkout/phone/verify` in this
     * session (2 hours), else 422 `PHONE_NOT_VERIFIED` (`details.phone`).
     */
    public function place(Request $request, PlaceOrder $place, OrderPresenter $presenter, CheckoutPhoneCheck $phoneCheck, TenantContext $tenant): JsonResponse
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
        $emailMode = $this->contact->emailMode();
        $data = $request->validate([
            'contact' => ['required', 'array'],
            'contact.name' => ['required', 'string', 'max:120'],
            'contact.email' => match ($emailMode) {
                'required' => ['required', 'string', 'email', 'max:255'],
                'hidden' => ['sometimes'],
                default => ['sometimes', 'nullable', 'string', 'email', 'max:255'],
            },
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
            // P2a: campaign attribution (sanitized; invalid parts dropped, never an error).
            'attribution' => ['sometimes', 'nullable'],
        ], [
            'contact.phone.regex' => 'Enter a Bangladeshi mobile number, e.g. 01712345678.',
            'address.phone.regex' => 'Enter a Bangladeshi mobile number, e.g. 01712345678.',
        ]);
        if ($useSaved) {
            unset($data['address']);
        }
        $email = $emailMode === 'hidden' || ! is_string($data['contact']['email'] ?? null) ? '' : trim($data['contact']['email']);
        $data['contact'] = ['name' => trim($data['contact']['name']), 'email' => $email === '' ? null : $email, 'phone' => trim($data['contact']['phone'])];
        $data['save_address'] = $request->boolean('save_address');
        $data['notes'] = filled($data['notes'] ?? null) ? trim($data['notes']) : null;
        $data['attribution'] = CampaignAttribution::sanitize($data['attribution'] ?? null);
        $data['source'] = Order::SOURCE_STOREFRONT;
        foreach (['recipient_name', 'area', 'address_line', 'postcode'] as $key) {
            if (isset($data['address'][$key]) && is_string($data['address'][$key])) {
                $data['address'][$key] = trim($data['address'][$key]) === '' ? null : trim($data['address'][$key]);
            }
        }

        // BD1a: before any stock or locking work.
        $phoneCheck->ensure($data['contact']['phone'], $data['payment_method'], fn () => CheckoutVerifiedPhones::forShopper($request, $tenant->requireOrganization(), $account));

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
