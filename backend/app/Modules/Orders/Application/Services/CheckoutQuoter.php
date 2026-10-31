<?php

namespace App\Modules\Orders\Application\Services;

use App\Modules\Cart\Application\Services\CartPricer;
use App\Modules\Cart\Infrastructure\Models\Cart;
use App\Modules\Customers\Application\Actions\CustomerAddressBook;
use App\Modules\OnlinePayments\Application\Contracts\CheckoutPaymentMethods;
use App\Modules\Sales\Domain\TaxMode;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Money;
use App\Modules\Shipping\Application\Contracts\ShippingRates;
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
 * per-customer limits count.
 *
 * Partial input is fine: without a district there are no delivery methods and no fee; an
 * unknown or unavailable method or payment method is reported as null.
 */
class CheckoutQuoter
{
    public function __construct(
        private readonly CartPricer $pricer,
        private readonly ShippingRates $shipping,
        private readonly CheckoutPaymentMethods $payments,
        private readonly CustomerAddressBook $addresses,
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
     *   coupon_code: ?string
     * }
     */
    public function quote(?Cart $cart, array $input, ?string $customerId, bool $autoPickMethod = false): array
    {
        $email = is_string($input['contact']['email'] ?? null) ? $input['contact']['email'] : null;
        $quote = $this->pricer->quote($cart, $email);
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

        $methods = $districtId === null ? [] : $this->shipping->methodsForDistrict($districtId);
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
        ];
    }
}
