<?php

namespace App\Modules\Promotions\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Promotions\Infrastructure\Models\Coupon;
use App\Modules\Promotions\Infrastructure\Models\PromotionRedemption;
use App\Modules\Promotions\Tests\Concerns\BuildsPromotions;
use App\Modules\Sales\Domain\Discount;
use App\Modules\Sales\Domain\SaleCalculator;
use App\Modules\Sales\Domain\TaxMode;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Promotions in the cart, the checkout preview and placement (E8b). Shop from BuildsCheckout:
 * Shirt 450 (5 in stock), Juice 120 + VAT 15% (10), Rice 60.50 (untracked); delivery inside
 * Dhaka 60 (free from 2000, no COD fee), outside 120 + COD fee 20.
 */
class PromotionCheckoutTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, BuildsPromotions, InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        config(['pos.coupon_rate_limit' => 1000]);
        $this->buildShop();
    }

    private function cart(): array
    {
        return $this->browse('GET', $this->storeUrl('cart'))->assertOk()->json('data');
    }

    private function applyCoupon(string $code)
    {
        return $this->browse('POST', $this->storeUrl('cart/coupon'), ['code' => $code]);
    }

    private function org()
    {
        return $this->tenant['organization'];
    }

    public function test_automatic_product_and_order_promotions_price_the_cart_through_sale_calculator(): void
    {
        $shirtSale = $this->makePromotion($this->org(), ['name' => 'Shirt sale', 'type' => 'percent', 'value' => '10', 'scope' => 'products', 'target_ids' => [$this->productOf($this->v['SHIRT'])]]);
        $order = $this->makePromotion($this->org(), ['name' => '50 off 500', 'type' => 'fixed', 'value' => '50', 'min_subtotal' => '500']);
        // A coupon promotion never applies by itself.
        $this->makePromotion($this->org(), ['name' => 'Coupon only', 'type' => 'percent', 'value' => '50', 'trigger' => 'coupon']);

        $this->addToCart('SHIRT', 2);
        $this->addToCart('JUICE', 1);
        $cart = $this->cart();

        $expected = SaleCalculator::calculate([
            ['quantity' => '2', 'unit_price' => '450.00', 'tax_rate' => '0', 'discount' => Discount::amount('90.00')],
            ['quantity' => '1', 'unit_price' => '120.00', 'tax_rate' => '15', 'discount' => null],
        ], Discount::amount('50.00'), TaxMode::Exclusive, 'BDT');

        $this->assertSame(['1020.00', '140.00', $expected['tax_total'], $expected['total']], [$cart['subtotal'], $cart['discount_total'], $cart['tax_total'], $cart['total']]);
        $this->assertSame('897.03', $cart['total']);
        $shirt = $cart['items'][0];
        $this->assertSame(['900.00', '133.55', ['id' => $shirtSale->id, 'name' => 'Shirt sale']], [$shirt['line_total'], $shirt['discount_amount'], $shirt['promotion']]);
        $this->assertSame(['120.00', '6.45', null], [$cart['items'][1]['line_total'], $cart['items'][1]['discount_amount'], $cart['items'][1]['promotion']]);
        $this->assertSame([
            ['id' => $shirtSale->id, 'name' => 'Shirt sale', 'kind' => 'product', 'amount' => '90.00'],
            ['id' => $order->id, 'name' => '50 off 500', 'kind' => 'order', 'amount' => '50.00'],
        ], $cart['promotions']);
        $this->assertNull($cart['free_shipping']);
        $this->assertNull($cart['coupon']);

        // The preview and the placed order agree with the cart.
        $preview = $this->previewCheckout(['address' => ['district_id' => self::DHAKA], 'shipping_method_id' => $this->methods['inside'], 'payment_method' => 'cod'])->assertOk()->json('data');
        $this->assertSame(['1020.00', '140.00', '60.00', '0.00', '957.03', null], [
            $preview['subtotal'], $preview['discount_total'], $preview['shipping_total'], $preview['shipping_discount'], $preview['total'], $preview['coupon_code'],
        ]);
        $this->assertSame([['name' => 'Shirt sale', 'kind' => 'product', 'amount' => '90.00'], ['name' => '50 off 500', 'kind' => 'order', 'amount' => '50.00']], $preview['promotions']);

        $placed = $this->placeOrder($this->checkoutBody('957.03'))->assertCreated()->json('data.order');
        $this->assertSame(['140.00', '0.00', null, '957.03'], [$placed['discount_total'], $placed['shipping_discount'], $placed['coupon_code'], $placed['total']]);
        $this->assertSame(['133.55', '6.45'], array_column($placed['lines'], 'discount_amount'));
        $this->assertCount(2, $placed['promotions']);

        $this->assertSame(2, PromotionRedemption::query()->withoutGlobalScopes()->count());
        $this->assertSame(['rina@example.test'], PromotionRedemption::query()->withoutGlobalScopes()->distinct()->pluck('email')->all());
        $this->assertSame('WEB-000001', PromotionRedemption::query()->withoutGlobalScopes()->value('order_number'));

        // Staff see the same discounts.
        $this->actingAsUser($this->tenant['admin']);
        $staff = $this->getJson('/api/v1/web-orders/'.Order::query()->withoutGlobalScopes()->value('id'))->assertOk()->json('data');
        $this->assertSame(['140.00', '0.00', null], [$staff['discount_total'], $staff['shipping_discount'], $staff['coupon_code']]);
        $this->assertSame('133.55', $staff['lines'][0]['discount_amount']);
        $this->assertSame('Shirt sale', $staff['promotions'][0]['name']);
    }

    public function test_coupon_apply_reasons_and_removal(): void
    {
        $this->addToCart('SHIRT', 1);
        $now = now();
        $shirt = $this->productOf($this->v['SHIRT']);
        $pills = $this->productOf($this->v['PILLS']);

        $invalid = function (string $code, string $reason) {
            $response = $this->applyCoupon($code)->assertStatus(422)->assertJsonPath('error.code', 'COUPON_INVALID')->assertJsonPath('error.details.reason', $reason);

            return $response->json('error');
        };

        $this->assertSame('This coupon code is not valid.', $invalid('NOPE', 'not_found')['message']);
        $invalid('x', 'not_found');

        $off = $this->makePromotion($this->org(), ['name' => 'Off', 'type' => 'fixed', 'value' => '10', 'trigger' => 'coupon', 'coupon_code' => 'OFFCODE']);
        Coupon::query()->withoutGlobalScopes()->where('code', 'OFFCODE')->update(['is_active' => false]);
        $invalid('offcode', 'not_found');
        $off->forceFill(['is_active' => false])->save();
        $this->makeCoupon($this->org(), $off, 'OFFPROMO');
        $invalid('OFFPROMO', 'not_found');

        $this->makePromotion($this->org(), ['name' => 'Soon', 'type' => 'fixed', 'value' => '10', 'trigger' => 'coupon', 'coupon_code' => 'SOON', 'starts_at' => $now->copy()->addDay()->toIso8601String()]);
        $invalid('soon', 'not_started');

        $this->makePromotion($this->org(), ['name' => 'Gone', 'type' => 'fixed', 'value' => '10', 'trigger' => 'coupon', 'coupon_code' => 'GONE', 'ends_at' => $now->copy()->subMinute()->toIso8601String()]);
        $invalid('GONE', 'expired');

        $used = $this->makePromotion($this->org(), ['name' => 'Used', 'type' => 'fixed', 'value' => '10', 'trigger' => 'coupon']);
        $this->makeCoupon($this->org(), $used, 'USEDUP', 1);
        Coupon::query()->withoutGlobalScopes()->where('code', 'USEDUP')->update(['used_count' => 1]);
        $invalid('USEDUP', 'usage_limit_reached');

        $this->makePromotion($this->org(), ['name' => 'Big spender', 'type' => 'fixed', 'value' => '100', 'min_subtotal' => '1000', 'trigger' => 'coupon', 'coupon_code' => 'BIG100']);
        $error = $invalid('BIG100', 'min_subtotal');
        $this->assertSame('1000.00', $error['details']['min_subtotal']);
        $this->assertSame('Add products worth at least 1000.00 BDT to use this coupon.', $error['message']);

        $this->makePromotion($this->org(), ['name' => 'Pills', 'type' => 'percent', 'value' => '10', 'scope' => 'products', 'target_ids' => [$pills], 'trigger' => 'coupon', 'coupon_code' => 'PILLS10']);
        $invalid('PILLS10', 'not_applicable');
        $this->assertNull($this->cart()['coupon']);

        // A valid code: applied, priced, upper-cased.
        $shirtCoupon = $this->makePromotion($this->org(), ['name' => 'Shirt 20', 'type' => 'percent', 'value' => '20', 'scope' => 'products', 'target_ids' => [$shirt], 'trigger' => 'coupon', 'coupon_code' => 'SHIRT20']);
        $cart = $this->applyCoupon(' shirt20 ')->assertOk()->json('data');
        $this->assertSame(['code' => 'SHIRT20', 'applied' => true, 'reason' => null, 'message' => null, 'promotion_name' => 'Shirt 20'], $cart['coupon']);
        $this->assertSame(['90.00', '360.00'], [$cart['discount_total'], $cart['total']]);
        $this->assertSame(['id' => $shirtCoupon->id, 'name' => 'Shirt 20'], $cart['items'][0]['promotion']);

        // An automatic promotion that gives more: the coupon stays, unused.
        $this->makePromotion($this->org(), ['name' => 'Shirt week', 'type' => 'percent', 'value' => '30', 'scope' => 'products', 'target_ids' => [$shirt]]);
        $cart = $this->cart();
        $this->assertSame(['code' => 'SHIRT20', 'applied' => false, 'reason' => 'better_offer', 'message' => 'A better offer is already applied.', 'promotion_name' => 'Shirt 20'], $cart['coupon']);
        $this->assertSame('135.00', $cart['discount_total']);
        // Applying it again is allowed (200) with the same note.
        $this->applyCoupon('SHIRT20')->assertOk()->assertJsonPath('data.coupon.reason', 'better_offer');

        $cart = $this->browse('DELETE', $this->storeUrl('cart/coupon'))->assertOk()->json('data');
        $this->assertNull($cart['coupon']);
        $this->assertSame('135.00', $cart['discount_total']);

        // No cart at all: nothing to apply to.
        $this->clearBrowser();
        $invalid('SHIRT20', 'not_applicable');
    }

    public function test_a_coupon_that_becomes_invalid_stays_on_the_cart_and_checkout_proceeds_without_it(): void
    {
        $this->makePromotion($this->org(), ['name' => 'Welcome 50', 'type' => 'fixed', 'value' => '50', 'min_subtotal' => '500', 'trigger' => 'coupon', 'coupon_code' => 'WELCOME50']);
        $this->addToCart('SHIRT', 2);
        $item = $this->cart()['items'][0]['id'];
        $this->applyCoupon('WELCOME50')->assertOk()->assertJsonPath('data.coupon.applied', true)->assertJsonPath('data.discount_total', '50.00');

        $cart = $this->browse('PATCH', $this->storeUrl("cart/items/{$item}"), ['quantity' => 1])->assertOk()->json('data');
        $this->assertSame(['WELCOME50', false, 'min_subtotal'], [$cart['coupon']['code'], $cart['coupon']['applied'], $cart['coupon']['reason']]);
        $this->assertSame(['0.00', '450.00'], [$cart['discount_total'], $cart['total']]);

        $preview = $this->previewCheckout(['address' => ['district_id' => self::DHAKA], 'shipping_method_id' => $this->methods['inside'], 'payment_method' => 'cod'])->json('data');
        $this->assertSame(['510.00', null, 'min_subtotal'], [$preview['total'], $preview['coupon_code'], $preview['coupon']['reason']]);

        $order = $this->placeOrder($this->checkoutBody('510.00'))->assertCreated()->json('data.order');
        $this->assertSame([null, '0.00', []], [$order['coupon_code'], $order['discount_total'], $order['promotions']]);
        $this->assertSame(0, PromotionRedemption::query()->withoutGlobalScopes()->count());
        $this->assertSame(0, (int) Coupon::query()->withoutGlobalScopes()->where('code', 'WELCOME50')->value('used_count'));
    }

    public function test_free_shipping_waives_the_delivery_fee_but_not_the_cod_fee(): void
    {
        $free = $this->makePromotion($this->org(), ['name' => 'Free delivery over 400', 'type' => 'free_shipping', 'min_subtotal' => '400']);
        $this->addToCart('JUICE', 1);
        $this->assertNull($this->cart()['free_shipping']);

        $this->addToCart('SHIRT', 1);
        $this->assertSame(['id' => $free->id, 'name' => 'Free delivery over 400'], $this->cart()['free_shipping']);

        $body = ['address' => ['district_id' => $this->otherDistrict], 'shipping_method_id' => $this->methods['outside'], 'payment_method' => 'cod'];
        $preview = $this->previewCheckout($body)->json('data');
        // Goods 450 + 120 + 18 VAT = 588; delivery 120 waived; COD fee 20 stays.
        $this->assertSame(['0.00', '120.00', '20.00', '608.00'], [$preview['shipping_total'], $preview['shipping_discount'], $preview['cod_fee'], $preview['total']]);
        $this->assertSame([['name' => 'Free delivery over 400', 'kind' => 'shipping', 'amount' => '120.00']], $preview['promotions']);

        $order = $this->placeOrder($this->checkoutBody('608.00', [
            'address' => $this->inlineAddress($this->otherDistrict, $this->otherDivision),
            'shipping_method_id' => $this->methods['outside'],
        ]))->assertCreated()->json('data.order');
        $this->assertSame(['0.00', '120.00', '20.00', '608.00', '0.00'], [$order['shipping_total'], $order['shipping_discount'], $order['cod_fee'], $order['total'], $order['discount_total']]);
        $this->assertSame([['name' => 'Free delivery over 400', 'kind' => 'shipping', 'amount' => '120.00']], $order['promotions']);
        $this->assertSame(['shipping', '120.00'], [
            PromotionRedemption::query()->withoutGlobalScopes()->value('kind'),
            (string) PromotionRedemption::query()->withoutGlobalScopes()->value('amount'),
        ]);
    }

    public function test_guest_coupon_limits_are_counted_by_email_at_placement(): void
    {
        $this->makePromotion($this->org(), ['name' => 'Once', 'type' => 'fixed', 'value' => '50', 'trigger' => 'coupon', 'usage_limit_per_customer' => 1, 'coupon_code' => 'ONCE50']);

        $this->addToCart('SHIRT', 1);
        $this->applyCoupon('once50')->assertOk();
        $key = (string) Str::uuid();
        $cookie = $this->jar['cart_token'];
        $first = $this->placeOrder($this->checkoutBody('460.00'), $key)->assertCreated();
        $this->assertSame(['ONCE50', '50.00'], [$first->json('data.order.coupon_code'), $first->json('data.order.discount_total')]);
        $this->assertSame(1, (int) Coupon::query()->withoutGlobalScopes()->value('used_count'));

        // A replay of the same request returns the first order and redeems nothing more.
        $this->jar['cart_token'] = $cookie;
        $this->placeOrder($this->checkoutBody('460.00'), $key)->assertCreated()->assertHeader('Idempotent-Replayed', 'true');
        $this->assertSame(1, PromotionRedemption::query()->withoutGlobalScopes()->count());
        $this->assertSame(1, (int) Coupon::query()->withoutGlobalScopes()->value('used_count'));

        // Another guest cart with the same e-mail (other case): the coupon applies to the
        // cart (unknown e-mail yet), but placement counts the e-mail → TOTAL_CHANGED.
        $this->clearBrowser();
        $this->addToCart('SHIRT', 1);
        $this->applyCoupon('ONCE50')->assertOk()->assertJsonPath('data.coupon.applied', true);
        $body = $this->checkoutBody('460.00', ['contact' => ['name' => 'Rina', 'email' => 'RINA@example.test', 'phone' => '01712345678']]);
        $changed = $this->placeOrder($body)->assertStatus(409)->assertJsonPath('error.code', 'TOTAL_CHANGED')->json('error.details');
        $this->assertSame('510.00', $changed['total']);
        $this->assertSame('customer_limit_reached', $changed['preview']['coupon']['reason']);

        $second = $this->placeOrder(['expected_total' => '510.00'] + $body)->assertCreated()->json('data.order');
        $this->assertNull($second['coupon_code']);
        $this->assertSame(1, PromotionRedemption::query()->withoutGlobalScopes()->count());
    }

    public function test_signed_in_customers_hit_their_limit_when_applying(): void
    {
        $this->makePromotion($this->org(), ['name' => 'Once', 'type' => 'fixed', 'value' => '50', 'trigger' => 'coupon', 'usage_limit_per_customer' => 1, 'coupon_code' => 'ONCE50']);
        $this->registerShopper(self::HOST);
        $this->addToCart('SHIRT', 1);
        $this->applyCoupon('ONCE50')->assertOk();
        $this->placeOrder($this->checkoutBody('460.00'))->assertCreated();

        $redemption = PromotionRedemption::query()->withoutGlobalScopes()->firstOrFail();
        $this->assertNotNull($redemption->customer_id);
        $this->assertNotNull($redemption->customer_account_id);

        $this->addToCart('SHIRT', 1);
        $this->applyCoupon('ONCE50')->assertStatus(422)->assertJsonPath('error.details.reason', 'customer_limit_reached')
            ->assertJsonPath('error.message', 'You have already used this coupon.');
    }

    public function test_a_total_usage_limit_reached_meanwhile_answers_total_changed(): void
    {
        $this->makePromotion($this->org(), ['name' => 'First order only', 'type' => 'fixed', 'value' => '40', 'usage_limit' => 1]);

        $this->addToCart('SHIRT', 1);
        $firstCart = $this->jar;
        $this->assertSame('410.00', $this->cart()['total']);
        $this->clearBrowser();
        $this->addToCart('SHIRT', 1);
        $secondCart = $this->jar;
        $this->assertSame('410.00', $this->cart()['total']);

        $this->jar = $firstCart;
        $this->placeOrder($this->checkoutBody('470.00'))->assertCreated()->assertJsonPath('data.order.discount_total', '40.00');

        // The second shopper confirmed 470 (with the promotion); it is used up now.
        $this->jar = $secondCart;
        $this->placeOrder($this->checkoutBody('470.00'))->assertStatus(409)->assertJsonPath('error.code', 'TOTAL_CHANGED')->assertJsonPath('error.details.total', '510.00');
        $this->assertSame('450.00', $this->cart()['total']);
        $this->assertSame(1, PromotionRedemption::query()->withoutGlobalScopes()->count());
    }

    public function test_coupon_attempts_are_rate_limited(): void
    {
        config(['pos.coupon_rate_limit' => 3]);
        $this->addToCart('SHIRT', 1);
        foreach (range(1, 3) as $ignored) {
            $this->applyCoupon('WRONG')->assertStatus(422);
        }
        $this->applyCoupon('WRONG')->assertStatus(429);
    }

    public function test_promotions_and_coupons_stay_inside_their_organization(): void
    {
        $shirt = $this->productOf($this->v['SHIRT']);
        $this->makePromotion($this->org(), ['name' => 'A sale', 'type' => 'percent', 'value' => '50']);
        $this->makePromotion($this->org(), ['name' => 'A coupon', 'type' => 'fixed', 'value' => '10', 'trigger' => 'coupon', 'coupon_code' => 'ACODE']);

        // Another shop on another host: none of A's promotions or codes. (The cart routes are
        // only used for B here: catalog read models cache their organization per instance.)
        $a = $this->tenant;
        $aVariants = $this->v;
        $this->clearBrowser();
        $this->buildShop('Tiny Shop', 'tiny.test');
        $this->addToCart('SHIRT', 1, 'tiny.test');
        $cart = $this->browse('GET', $this->storeUrl('cart', 'tiny.test'))->json('data');
        $this->assertSame(['0.00', []], [$cart['discount_total'], $cart['promotions']]);
        $this->browse('POST', $this->storeUrl('cart/coupon', 'tiny.test'), ['code' => 'ACODE'])->assertStatus(422)->assertJsonPath('error.details.reason', 'not_found');
        $this->assertNotSame($aVariants['SHIRT'], $this->v['SHIRT']);
        $this->assertNotSame($shirt, $this->productOf($this->v['SHIRT']));
        $this->assertNotSame($a['organization']->id, $this->tenant['organization']->id);
    }
}
