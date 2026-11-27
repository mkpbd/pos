<?php

namespace App\Modules\Orders\Presentation\Http\Controllers;

use App\Modules\Orders\Application\Actions\EditOrder;
use App\Modules\Orders\Application\Actions\PlaceStaffOrder;
use App\Modules\Orders\Application\Services\StaffOrderPricing;
use App\Modules\Orders\Domain\OrderPaymentMethod;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Presentation\Http\Support\OrderPresenter;
use App\Modules\Shared\Domain\BangladeshMobile;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * BD1b: orders staff enter (taken by phone, Facebook, WhatsApp…) and changes to an order
 * before it ships. Pricing is the checkout's (current prices, promotions, coupon, delivery
 * and COD fees), recomputed by the server on every call.
 */
class StaffOrderController
{
    private const MOBILE_MESSAGE = 'Enter a Bangladeshi mobile number, e.g. 01712345678.';

    public function __construct(private readonly OrderPresenter $presenter) {}

    /**
     * Price an order (staff)
     *
     * Needs `web_orders.create` or `web_orders.edit` (403 otherwise). No writes. Body (all
     * optional but `lines`): `order_id` (editing: that order's own quantities count as
     * available, its own promotion uses do not count against limits, its payment method
     * applies), `customer_id` (an existing customer; unknown → 422), `contact {name, phone,
     * email?}`, `lines [{variant_id, quantity}]` (1–100), `address {…, district_id}`,
     * `shipping_method_id`, `payment_method` (cod | bank_transfer), `coupon_code`. Returns the
     * checkout preview (lines with `product_name`, `image_url`, `available`; `issues`) plus
     * `payment_methods: [{code, name}]` (enabled offline methods). `CHECKOUT_UNAVAILABLE`
     * without a fulfilment store.
     */
    public function quote(Request $request, StaffOrderPricing $pricing): JsonResponse
    {
        $user = $request->user();
        if (! $user->can('web_orders.create') && ! $user->can('web_orders.edit')) {
            throw new AuthorizationException;
        }
        $this->normalizePhones($request);
        $data = $request->validate([
            'order_id' => ['sometimes', 'nullable', 'uuid'],
            'customer_id' => ['sometimes', 'nullable', 'uuid'],
            'contact' => ['sometimes', 'nullable', 'array'],
            'contact.name' => ['sometimes', 'nullable', 'string', 'max:120'],
            'contact.phone' => ['sometimes', 'nullable', 'string', 'max:30'],
            'contact.email' => ['sometimes', 'nullable', 'string', 'max:255'],
            ...self::lineRules(),
            'address' => ['sometimes', 'nullable', 'array'],
            'address.division_id' => ['sometimes', 'nullable', 'integer'],
            'address.district_id' => ['sometimes', 'nullable', 'integer'],
            // BD2a: the delivery area (prices the delivery).
            'address.area_id' => ['sometimes', 'nullable', 'uuid'],
            'shipping_method_id' => ['sometimes', 'nullable', 'uuid'],
            'payment_method' => ['sometimes', 'nullable', 'string', Rule::in(OrderPaymentMethod::values())],
            'coupon_code' => ['sometimes', 'nullable', 'string', 'max:40'],
        ]);
        $order = null;
        if (filled($data['order_id'] ?? null)) {
            /** @var Order $order */
            $order = Order::query()->whereKey($data['order_id'])->firstOrFail();
        }

        return ApiResponse::success($pricing->preview($data, $order));
    }

    /**
     * Enter an order (staff)
     *
     * `web_orders.create`, header `Idempotency-Key`. Body: the quote body without `order_id`,
     * plus required `contact {name, phone, email?}`, `address {recipient_name, phone,
     * division_id, district_id, area?, area_id?, address_line, postcode?}`, `shipping_method_id`,
     * `payment_method` (cod | bank_transfer), `channel` (phone | facebook | whatsapp |
     * instagram | walk_in | other), `expected_total`; optional `notes` (≤ 500), `locale`
     * (en | bn, default the store's language: the customer's e-mails and text messages).
     * Cash on delivery starts `confirmed`, bank transfer `pending_payment`; no access token.
     * 201 → the order detail. Errors as checkout: `ITEMS_UNAVAILABLE`, `SHIPPING_UNAVAILABLE`,
     * `PAYMENT_METHOD_UNAVAILABLE`, `TOTAL_CHANGED` (409, details.preview),
     * `CHECKOUT_UNAVAILABLE`, field errors.
     */
    public function store(Request $request, PlaceStaffOrder $place): JsonResponse
    {
        $this->normalizePhones($request);
        $data = $request->validate([
            'customer_id' => ['sometimes', 'nullable', 'uuid'],
            ...self::contentRules(),
            'payment_method' => ['required', 'string', Rule::in(OrderPaymentMethod::values())],
            'channel' => ['required', 'string', Rule::in(array_keys(Order::CHANNELS))],
            'locale' => ['sometimes', 'nullable', Rule::in(['en', 'bn'])],
        ], self::messages());
        $order = $place(self::clean($data), (string) $request->user()->getAuthIdentifier());

        return ApiResponse::created($this->presenter->staff($order->fresh() ?? $order, ...$this->abilities($request)));
    }

    /**
     * Change an order (staff)
     *
     * `web_orders.edit`, header `Idempotency-Key`. Body: `contact`, `lines` (1–100), `address`,
     * `shipping_method_id`, `coupon_code?` (omitted: the order's code), `notes?` (omitted:
     * unchanged), `expected_total`, `reason?` (≤ 200). The payment method does not change.
     * Only unpaid orders awaiting confirmation or payment, confirmed or processing, without a
     * shipment: else 422 `ORDER_NOT_EDITABLE` (`details.reason` status | paid | shipped).
     * 200 → the order detail (`revision` + 1, the change in `edits`). Errors as entering an
     * order (`TOTAL_CHANGED` 409 with `details.preview`).
     */
    public function update(Request $request, Order $webOrder, EditOrder $edit): JsonResponse
    {
        $this->normalizePhones($request);
        $data = $request->validate([
            ...self::contentRules(),
            'reason' => ['sometimes', 'nullable', 'string', 'max:200'],
        ], self::messages());

        $order = $edit($webOrder, self::clean($data), (string) $request->user()->getAuthIdentifier());

        return ApiResponse::success($this->presenter->staff($order->fresh() ?? $order, ...$this->abilities($request)));
    }

    /**
     * @return array{0: bool, 1: bool, 2: bool}
     */
    private function abilities(Request $request): array
    {
        $user = $request->user();

        return [$user->can('web_orders.manage'), $user->can('web_orders.refund'), $user->can('web_orders.edit')];
    }

    /**
     * @return array<string, list<mixed>>
     */
    private static function lineRules(): array
    {
        return [
            'lines' => ['required', 'array', 'min:1', 'max:100'],
            'lines.*' => ['required', 'array'],
            'lines.*.variant_id' => ['required', 'uuid'],
            'lines.*.quantity' => ['required', 'numeric', 'gt:0', 'max:99999', 'decimal:0,3'],
        ];
    }

    /**
     * @return array<string, list<mixed>>
     */
    private static function contentRules(): array
    {
        $mobile = ['string', 'regex:'.BangladeshMobile::PATTERN];

        return [
            'contact' => ['required', 'array'],
            'contact.name' => ['required', 'string', 'max:120'],
            'contact.phone' => ['required', ...$mobile],
            'contact.email' => ['sometimes', 'nullable', 'string', 'email', 'max:255'],
            ...self::lineRules(),
            'address' => ['required', 'array'],
            'address.recipient_name' => ['required', 'string', 'max:120'],
            'address.phone' => ['required', ...$mobile],
            'address.division_id' => ['required', 'integer', 'exists:geo_divisions,id'],
            'address.district_id' => ['required', 'integer', 'exists:geo_districts,id'],
            'address.area' => ['sometimes', 'nullable', 'string', 'max:100'],
            // BD2a: a delivery area of the district — required when the district has active areas.
            'address.area_id' => ['sometimes', 'nullable', 'uuid'],
            'address.address_line' => ['required', 'string', 'max:255'],
            'address.postcode' => ['sometimes', 'nullable', 'string', 'regex:/^\d{4}$/'],
            'shipping_method_id' => ['required', 'uuid'],
            'coupon_code' => ['sometimes', 'nullable', 'string', 'max:40'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:500'],
            'expected_total' => ['required', 'numeric', 'min:0', 'decimal:0,2'],
        ];
    }

    /**
     * @return array<string, string>
     */
    private static function messages(): array
    {
        return ['contact.phone.regex' => self::MOBILE_MESSAGE, 'address.phone.regex' => self::MOBILE_MESSAGE];
    }

    /**
     * Mobile numbers as 01XXXXXXXXX before validation (any common spelling is accepted).
     */
    private function normalizePhones(Request $request): void
    {
        foreach (['contact', 'address'] as $group) {
            $phone = $request->input($group.'.phone');
            if (is_string($phone) && trim($phone) !== '') {
                $request->merge([$group => array_replace((array) $request->input($group), ['phone' => BangladeshMobile::normalize($phone) ?? $phone])]);
            }
        }
    }

    /**
     * Trimmed text; blank optional values become null.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private static function clean(array $data): array
    {
        $text = fn (mixed $v) => is_string($v) && trim($v) !== '' ? trim($v) : null;
        $data['contact'] = ['name' => trim($data['contact']['name']), 'phone' => $data['contact']['phone'], 'email' => $text($data['contact']['email'] ?? null)];
        foreach (['recipient_name', 'area', 'address_line', 'postcode'] as $key) {
            if (array_key_exists($key, $data['address'])) {
                $data['address'][$key] = $text($data['address'][$key]);
            }
        }
        foreach (['notes', 'reason'] as $key) {
            if (array_key_exists($key, $data)) {
                $data[$key] = $text($data[$key]);
            }
        }

        return $data;
    }
}
