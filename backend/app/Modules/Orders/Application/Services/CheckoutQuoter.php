<?php

namespace App\Modules\Orders\Application\Services;

use App\Modules\Cart\Application\Services\CartPricer;
use App\Modules\Cart\Infrastructure\Models\Cart;
use App\Modules\Customers\Application\Actions\CustomerAddressBook;
use App\Modules\OnlinePayments\Application\Contracts\CheckoutPaymentMethods;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Sales\Domain\TaxMode;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\BangladeshMobile;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Money;
use App\Modules\Shipping\Application\Contracts\ShippingRates;
use App\Modules\Shipping\Domain\ParcelWeight;
use App\Modules\Shipping\Domain\ShippingFee;

/**
 * The one checkout pricing path (ADR-005), shared by the preview and the placement:
 * the cart repriced by CartPricer (live prices, availability, SaleCalculator with the
 * organization's tax mode), then the delivery fee of the chosen method (free from
 * `free_over`, compared with the goods total after tax) and the cash-on-delivery fee.
 * Delivery and COD fees are added after tax and are not taxed in E8a.
 *
 * Promotions (E8b) come with the cart pricing (product and order discounts, before tax);
 * a free-delivery promotion waives the delivery fee (`shipping_discount` = the waived fee,
 * `shipping_total` 0) but not the COD fee. Placement passes the contact e-mail so guests'
 * per-customer limits count; BD1a: and the contact mobile number (counted for everyone).
 *
 * Partial input is fine: without a district there are no delivery methods and no fee; an
 * unknown or unavailable method or payment method is reported as null.
 *
 * BD2a: the delivery is priced for the address's delivery area (`address.area_id`; a saved
 * address's area matched by name) and the weight of the priced lines (Σ variant
 * `weight_grams` × quantity, rounded up to whole grams; no weight counts 0). The quote says
 * which area was used (`area`) and, for placement, the field error when the district has
 * active areas and none of them was chosen, or the area is not one of the district's
 * (`area_error`; the preview just ignores such an area).
 */
class CheckoutQuoter
{
    public function __construct(
        private readonly CartPricer $pricer,
        private readonly ShippingRates $shipping,
        private readonly CheckoutPaymentMethods $payments,
        private readonly CustomerAddressBook $addresses,
        // BD2a: the variants' weights.
        private readonly ProductDirectory $products,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * @param  array<string, mixed>  $input  checkout body (any subset)
     * @return array{
     *   preview: array<string, mixed>,
     *   cart: array<string, mixed>,
     *   lines: list<array<string, mixed>>,
     *   tax_mode: TaxMode,
     *   district_id: ?int,
     *   saved_address: ?array<string, mixed>,
     *   method: ?array<string, mixed>,
     *   payment_method: ?string,
     *   goods_total: string,
     *   shipping_discount: string,
     *   redemptions: list<array{promotion_id: string, coupon_id: ?string, name: string, kind: string, amount: string}>,
     *   coupon_code: ?string,
     *   area: ?array{id: string, name: string},
     *   area_error: ?array<string, list<string>>
     * }
     */
    public function quote(?Cart $cart, array $input, ?string $customerId, bool $autoPickMethod = false): array
    {
        [$email, $phone] = self::contact($input);

        return $this->complete($this->pricer->quote($cart, $email, false, $phone), $input, $customerId, $autoPickMethod);
    }

    /**
     * P2a: the same quote for lines that are not in a cart (a landing page's order form):
     * `[{variant_id, quantity}]`, priced through the cart's pricing path without a coupon.
     *
     * BD1b: staff orders pass a `$couponCode`, and an order being edited the stock it already
     * holds (`$held`, variant id => quantity), which counts as available.
     *
     * @param  list<array{variant_id: string, quantity: string}>  $lines
     * @param  array<string, mixed>  $input
     * @param  array<string, string>  $held
     * @return array<string, mixed> as quote()
     */
    public function quoteLines(array $lines, array $input, ?string $customerId, bool $autoPickMethod = false, ?string $couponCode = null, array $held = []): array
    {
        [$email, $phone] = self::contact($input);
        $items = [];
        foreach (array_values($lines) as $i => $line) {
            $items[] = ['id' => 'line-'.$i, 'variant_id' => $line['variant_id'], 'quantity' => (string) $line['quantity']];
        }

        return $this->complete($this->pricer->quoteItems($items, $customerId, $email, $couponCode, null, $phone, $held), $input, $customerId, $autoPickMethod);
    }

    /**
     * The contact e-mail and (BD1a) mobile number of the checkout body, when given.
     *
     * @param  array<string, mixed>  $input
     * @return array{0: ?string, 1: ?string}
     */
    private static function contact(array $input): array
    {
        $email = is_string($input['contact']['email'] ?? null) && trim($input['contact']['email']) !== '' ? $input['contact']['email'] : null;
        $phone = is_string($input['contact']['phone'] ?? null) ? BangladeshMobile::normalize($input['contact']['phone']) : null;

        return [$email, $phone];
    }

    /**
     * @param  array<string, mixed>  $quote  CartPricer quote
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    private function complete(array $quote, array $input, ?string $customerId, bool $autoPickMethod): array
    {
        $promotions = $quote['promotions'];
        $view = $quote['cart'];
        $currency = $view['currency'];

        $savedAddress = null;
        $districtId = null;
        if ($customerId !== null && is_string($input['shipping_address_id'] ?? null)) {
            $savedAddress = $this->addresses->find($customerId, $input['shipping_address_id']);
            $districtId = $savedAddress['district']['id'] ?? null;
        } elseif (is_numeric($input['address']['district_id'] ?? null)) {
            $districtId = (int) $input['address']['district_id'];
        }

        [$area, $areaError] = $districtId === null ? [null, null] : $this->area($districtId, $savedAddress, $input);
        $methods = $districtId === null ? [] : $this->shipping->methodsForDistrict($districtId, $area['id'] ?? null, $this->weightGrams($quote['lines']));
        $method = null;
        foreach ($methods as $candidate) {
            if ($candidate['id'] === ($input['shipping_method_id'] ?? null)) {
                $method = $candidate;
            }
        }

        // The preview picks the only method there is; placement insists on the shopper's choice.
        if ($method === null && $autoPickMethod && count($methods) === 1) {
            $method = $methods[0];
        }

        $goods = Money::of($view['total'], $currency);
        $delivery = $method === null ? Money::zero($currency) : Money::of(ShippingFee::delivery($method['fee'], $method['free_over'], $goods->amount()), $currency);
        $shippingDiscount = Money::zero($currency);
        if ($promotions->freeShipping !== null) {
            $shippingDiscount = $delivery;
            $delivery = Money::zero($currency);
        }
        $redemptions = $promotions->redemptions;
        if (($shipping = $promotions->shippingRedemption($shippingDiscount->amount())) !== null) {
            $redemptions[] = $shipping;
        }
        // The order keeps the code only when the coupon was redeemed.
        $couponCode = array_filter($redemptions, fn (array $r) => $r['coupon_id'] !== null) === [] ? null : ($promotions->coupon['code'] ?? null);
        $shownPromotions = array_map(fn (array $p) => ['name' => $p['name'], 'kind' => $p['kind'], 'amount' => $p['amount']], $promotions->promotions);
        if ($shipping !== null) {
            $shownPromotions[] = ['name' => $shipping['name'], 'kind' => 'shipping', 'amount' => $shipping['amount']];
        }

        $paymentMethod = is_string($input['payment_method'] ?? null) ? $input['payment_method'] : null;
        $codFee = Money::zero($currency);
        if ($paymentMethod === 'cod' && $method !== null) {
            $codFee = Money::of(ShippingFee::cashOnDelivery($method['cod_allowed'], $method['cod_fee'], true), $currency);
        }
        $total = $goods->plus($delivery)->plus($codFee);

        if ($paymentMethod !== null) {
            try {
                $this->payments->usable($paymentMethod, $total->amount(), $method['cod_allowed'] ?? true);
            } catch (BusinessRuleViolation) {
                $paymentMethod = null;
                $total = $total->minus($codFee);
                $codFee = Money::zero($currency);
            }
        }

        return [
            'preview' => [
                'lines' => $view['items'],
                'subtotal' => $view['subtotal'],
                'discount_total' => $view['discount_total'],
                'tax_total' => $view['tax_total'],
                'shipping_total' => $delivery->amount(),
                'shipping_discount' => $shippingDiscount->amount(),
                // BD2a: the chosen method's fee before free_over / promotions, explained.
                'shipping_breakdown' => $method === null ? null : self::breakdown($method),
                'cod_fee' => $codFee->amount(),
                'total' => $total->amount(),
                'currency' => $currency,
                'prices_include_tax' => $view['prices_include_tax'],
                'shipping_methods' => $methods,
                'shipping_method_id' => $method['id'] ?? null,
                'payment_method' => $paymentMethod,
                'promotions' => $shownPromotions,
                'coupon_code' => $couponCode,
                'coupon' => $view['coupon'],
                'issues' => $view['issues'],
            ],
            'cart' => $view,
            'lines' => $quote['lines'],
            'tax_mode' => $quote['tax_mode'],
            'district_id' => $districtId,
            'saved_address' => $savedAddress,
            'method' => $method,
            'payment_method' => $paymentMethod,
            'goods_total' => $goods->amount(),
            'shipping_discount' => $shippingDiscount->amount(),
            'redemptions' => $redemptions,
            'coupon_code' => $couponCode,
            'area' => $area,
            'area_error' => $areaError,
        ];
    }

    /**
     * BD2a: `{base_fee, area_adjustment, weight_fee}` of a priced delivery method.
     *
     * @param  array<string, mixed>  $method
     * @return array{base_fee: string, area_adjustment: string, weight_fee: string}
     */
    public static function breakdown(array $method): array
    {
        return ['base_fee' => $method['base_fee'], 'area_adjustment' => $method['area_adjustment'], 'weight_fee' => $method['weight_fee']];
    }

    /**
     * BD2a: the delivery area of the address (`{id, name}` or null) and the field error placing
     * the order would raise (null when fine). A saved address uses the district's area of the
     * same name; an inline address its `area_id`.
     *
     * @param  array<string, mixed>|null  $savedAddress
     * @param  array<string, mixed>  $input
     * @return array{0: ?array{id: string, name: string}, 1: ?array<string, list<string>>}
     */
    private function area(int $districtId, ?array $savedAddress, array $input): array
    {
        $areas = $this->shipping->areas($districtId);
        if ($savedAddress !== null) {
            $name = mb_strtolower(trim((string) ($savedAddress['area'] ?? '')));
            foreach ($areas as $candidate) {
                if (mb_strtolower($candidate['name']) === $name) {
                    return [['id' => $candidate['id'], 'name' => $candidate['name']], null];
                }
            }

            return [null, $areas === [] ? null : ['shipping_address_id' => ['Choose the delivery area for this address: enter the address again and pick its area.']]];
        }

        $areaId = is_string($input['address']['area_id'] ?? null) && $input['address']['area_id'] !== '' ? strtolower($input['address']['area_id']) : null;
        if ($areaId === null) {
            return [null, $areas === [] ? null : ['address.area_id' => ['Choose the delivery area.']]];
        }
        foreach ($areas as $candidate) {
            if ($candidate['id'] === $areaId) {
                return [['id' => $candidate['id'], 'name' => $candidate['name']], null];
            }
        }

        return [null, ['address.area_id' => ['Choose an area of the selected district.']]];
    }

    /**
     * BD2a: the priced lines' weight (Domain\ParcelWeight).
     *
     * @param  list<array<string, mixed>>  $lines  CartPricer lines
     */
    private function weightGrams(array $lines): int
    {
        return $lines === [] ? 0 : ParcelWeight::grams($lines, $this->products->variants($this->tenant->requireOrganization(), array_values(array_unique(array_column($lines, 'variant_id')))));
    }
}
