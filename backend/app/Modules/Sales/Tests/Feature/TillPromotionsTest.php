<?php

namespace App\Modules\Sales\Tests\Feature;

use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Promotions\Application\Contracts\PromotionPricing;
use App\Modules\Promotions\Infrastructure\Models\Coupon;
use App\Modules\Promotions\Infrastructure\Models\PromotionRedemption;
use App\Modules\Promotions\Tests\Concerns\BuildsPromotions;
use App\Modules\Sales\Infrastructure\Models\SaleLine;
use App\Modules\Sales\Infrastructure\Models\SalePromotion;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * POS1a §4: promotions and coupons at the till — channels, precedence, redemptions under
 * the lock, cancellation, isolation.
 */
class TillPromotionsTest extends TestCase
{
    use BuildsPromotions, InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    private Organization $org;

    private User $admin;

    private User $cashier;

    private string $store;

    private string $branchId;

    private ProductVariant $soap;

    private ProductVariant $oil;

    protected function setUp(): void
    {
        parent::setUp();
        ['admin' => $this->admin, 'organization' => $this->org, 'branch' => $branch] = $this->provisionTenant();
        $this->store = $this->mainStoreId($this->org);
        $this->branchId = $branch->id;
        $this->cashier = $this->createUserWithRole($this->org, SystemRole::Cashier, [$branch->id]);
        $this->soap = $this->sellable($this->org, 'Soap', '100.00');
        $this->oil = $this->sellable($this->org, 'Oil', '50.00');
        $this->actingAsUser($this->admin);
        $this->stockUp($this->store, $this->soap, '50');
        $this->stockUp($this->store, $this->oil, '50');
    }

    private function soapSale(array $extra = []): void
    {
        $this->makePromotion($this->org, $extra + ['name' => 'Soap week', 'type' => 'percent', 'value' => '10', 'scope' => 'products', 'target_ids' => [$this->productOf($this->soap->id)], 'channels' => ['till']]);
    }

    public function test_product_and_order_promotions_price_the_till_cart_and_are_kept_on_the_sale(): void
    {
        $this->soapSale();
        $order = $this->makePromotion($this->org, ['name' => '20 off 200', 'type' => 'fixed', 'value' => '20', 'min_subtotal' => '200', 'channels' => ['online', 'till']]);
        $this->actingAsUser($this->cashier);
        $cart = $this->cart($this->store, [[$this->soap, '2'], [$this->oil, '1']]);

        $preview = $this->postJson('/api/v1/pos/price', $cart)->assertOk()
            ->assertJsonPath('data.subtotal', '250.00')
            ->assertJsonPath('data.lines.0.promotion', ['name' => 'Soap week', 'amount' => '20.00'])
            ->assertJsonPath('data.lines.0.discount', null)
            ->assertJsonPath('data.lines.0.discount_amount', '20.00')
            ->assertJsonPath('data.lines.1.promotion', null)
            ->assertJsonPath('data.invoice_discount.source', 'promotion')
            ->assertJsonPath('data.invoice_discount_total', '20.00')
            ->assertJsonPath('data.promotions', [
                ['name' => 'Soap week', 'kind' => 'product', 'amount' => '20.00'],
                ['name' => '20 off 200', 'kind' => 'order', 'amount' => '20.00'],
            ])
            ->assertJsonPath('data.coupon', null)
            ->assertJsonPath('data.total', '210.00')
            ->assertJsonPath('data.savings_total', '40.00')
            ->json('data');

        $sale = $this->checkout(['payments' => [['method' => 'cash', 'amount' => '210.00']]] + $cart)->assertCreated()
            ->assertJsonPath('data.total', $preview['total'])
            ->assertJsonPath('data.lines.0.promotion', ['name' => 'Soap week', 'amount' => '20.00'])
            ->assertJsonPath('data.promotions.1', ['name' => '20 off 200', 'kind' => 'order', 'amount' => '20.00'])
            ->assertJsonPath('data.savings_total', '40.00')
            ->json('data');

        $this->assertSame(2, SalePromotion::query()->withoutGlobalScopes()->where('sale_id', $sale['id'])->count());
        $this->assertSame('20.00', (string) SaleLine::query()->withoutGlobalScopes()->where('sale_id', $sale['id'])->where('position', 0)->value('promotion_discount'));
        $redemptions = PromotionRedemption::query()->withoutGlobalScopes()->where('sale_id', $sale['id'])->get();
        $this->assertCount(2, $redemptions);
        $this->assertNull($redemptions->first()->order_id);
        $this->assertSame($sale['number'], $redemptions->first()->order_number);

        // The admin's redemptions list names the sale.
        $this->actingAsUser($this->admin);
        $this->getJson("/api/v1/promotions/{$order->id}/redemptions")->assertOk()
            ->assertJsonPath('data.0.sale_id', $sale['id'])
            ->assertJsonPath('data.0.order_id', null)
            ->assertJsonPath('data.0.order_number', $sale['number']);
    }

    public function test_channels_keep_online_and_till_promotions_apart(): void
    {
        $this->makePromotion($this->org, ['name' => 'Web only', 'type' => 'percent', 'value' => '50']);
        $online = $this->makePromotion($this->org, ['name' => 'Web code', 'type' => 'percent', 'value' => '50', 'trigger' => 'coupon']);
        $this->makeCoupon($this->org, $online, 'WEB50');
        $this->soapSale();
        $this->actingAsUser($this->cashier);

        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$this->soap, '1'], [$this->oil, '1']], [], ['coupon_code' => 'web50']))->assertOk()
            ->assertJsonPath('data.promotions', [['name' => 'Soap week', 'kind' => 'product', 'amount' => '10.00']])
            ->assertJsonPath('data.invoice_discount', null)
            ->assertJsonPath('data.coupon.code', 'WEB50')
            ->assertJsonPath('data.coupon.status', 'invalid')
            ->assertJsonPath('data.coupon.reason', 'not_found');

        // The web path (default channel) sees only online promotions.
        $quote = $this->inTenant($this->org, fn () => app(PromotionPricing::class)->price([
            ['key' => 0, 'product_id' => $this->productOf($this->soap->id), 'brand_id' => null, 'category_id' => null, 'quantity' => '1', 'unit_price' => '100.00'],
        ], null, null, null, 'BDT'));
        $this->assertSame(['Web only'], array_column($quote->promotions, 'name'));
        $this->assertSame('0.00', $quote->lineDiscount(0));
    }

    public function test_coupons_apply_or_fail_checkout_and_their_limit_is_counted(): void
    {
        $promotion = $this->makePromotion($this->org, ['name' => 'Till 10%', 'type' => 'percent', 'value' => '10', 'trigger' => 'coupon', 'channels' => ['till'], 'min_subtotal' => '100']);
        $this->makeCoupon($this->org, $promotion, 'SHOP10', 1);
        $this->actingAsUser($this->cashier);

        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$this->oil, '1']], [], ['coupon_code' => 'SHOP10']))->assertOk()
            ->assertJsonPath('data.coupon.status', 'invalid')
            ->assertJsonPath('data.coupon.reason', 'min_subtotal')
            ->assertJsonPath('data.total', '50.00');
        $this->checkout($this->cart($this->store, [[$this->oil, '1']], [['cash', '50.00']], ['coupon_code' => 'SHOP10']))
            ->assertStatus(422)->assertJsonPath('error.code', 'COUPON_INVALID')->assertJsonPath('error.details.reason', 'min_subtotal');
        $this->checkout($this->cart($this->store, [[$this->oil, '1']], [['cash', '50.00']], ['coupon_code' => 'NOSUCH']))
            ->assertStatus(422)->assertJsonPath('error.code', 'COUPON_INVALID')->assertJsonPath('error.details.reason', 'not_found');

        $cart = $this->cart($this->store, [[$this->soap, '2']], [['cash', '180.00']], ['coupon_code' => 'shop10']);
        $this->postJson('/api/v1/pos/price', $cart)->assertOk()
            ->assertJsonPath('data.coupon', ['code' => 'SHOP10', 'status' => 'applied', 'reason' => null, 'message' => null])
            ->assertJsonPath('data.invoice_discount.source', 'promotion')
            ->assertJsonPath('data.total', '180.00');
        $sale = $this->checkout($cart)->assertCreated()->assertJsonPath('data.coupon_code', 'SHOP10')->json('data');
        $this->assertSame(1, (int) Coupon::query()->withoutGlobalScopes()->where('code', 'SHOP10')->value('used_count'));

        // Used up: counted under the coupon's lock at the next checkout.
        $this->checkout($cart)->assertStatus(422)->assertJsonPath('error.code', 'COUPON_INVALID')->assertJsonPath('error.details.reason', 'usage_limit_reached');

        // Cancelling the sale gives the coupon back.
        $this->actingAsUser($this->admin);
        $this->openSession($this->admin, $this->branchId, '500.00');
        $this->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason' => 'Rung up twice'])->assertOk();
        $this->assertSame(0, (int) Coupon::query()->withoutGlobalScopes()->where('code', 'SHOP10')->value('used_count'));
        $this->assertNotNull(PromotionRedemption::query()->withoutGlobalScopes()->where('sale_id', $sale['id'])->value('released_at'));
        $this->actingAsUser($this->cashier);
        $this->checkout($cart)->assertCreated()->assertJsonPath('data.coupon_code', 'SHOP10');
    }

    public function test_manual_discounts_and_changed_prices_take_precedence_over_promotions(): void
    {
        $this->soapSale();
        $this->makePromotion($this->org, ['name' => '5% off', 'type' => 'percent', 'value' => '5', 'channels' => ['till']]);
        $code = $this->makePromotion($this->org, ['name' => 'Code 30', 'type' => 'fixed', 'value' => '30', 'trigger' => 'coupon', 'channels' => ['till']]);
        $this->makeCoupon($this->org, $code, 'TAKE30');

        // A manual item discount replaces the line's promotion; a changed price gets none.
        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [
            [$this->soap, '1', ['discount' => ['type' => 'amount', 'value' => '5']]],
            [$this->soap, '1', ['unit_price' => '80']],
            [$this->soap, '1'],
        ]))->assertOk()
            ->assertJsonPath('data.lines.0.promotion', null)
            ->assertJsonPath('data.lines.0.discount_amount', '5.00')
            ->assertJsonPath('data.lines.1.promotion', null)
            ->assertJsonPath('data.lines.1.discount_amount', '0.00')
            ->assertJsonPath('data.lines.2.promotion.amount', '10.00')
            // 5% of what is left after item discounts: 280 − 5 − 10 = 265 → 13.25
            ->assertJsonPath('data.invoice_discount_total', '13.25')
            ->assertJsonPath('data.invoice_discount.source', 'promotion');

        // The coupon beats the automatic order promotion when it gives more…
        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$this->oil, '2']], [], ['coupon_code' => 'TAKE30']))->assertOk()
            ->assertJsonPath('data.coupon.status', 'applied')
            ->assertJsonPath('data.invoice_discount_total', '30.00');
        // …and a manual invoice discount beats both (the coupon is then not applicable, not invalid).
        $cart = $this->cart($this->store, [[$this->oil, '2']], [['cash', '90.00']], ['coupon_code' => 'TAKE30', 'invoice_discount' => ['type' => 'amount', 'value' => '10']]);
        $this->postJson('/api/v1/pos/price', $cart)->assertOk()
            ->assertJsonPath('data.invoice_discount.source', 'manual')
            ->assertJsonPath('data.invoice_discount_total', '10.00')
            ->assertJsonPath('data.promotions', [])
            ->assertJsonPath('data.coupon.status', 'not_applicable');
        $sale = $this->checkout($cart)->assertCreated()->assertJsonPath('data.coupon_code', null)->json('data');
        $this->assertSame(0, PromotionRedemption::query()->withoutGlobalScopes()->where('sale_id', $sale['id'])->count());
    }

    public function test_order_promotion_beats_the_customer_group_discount(): void
    {
        $member = $this->customer($this->org, 'Member', groupDiscount: '5');
        $this->actingAsUser($this->cashier);
        $cart = $this->cart($this->store, [[$this->oil, '2']], [], ['customer_id' => $member->id]);

        $this->postJson('/api/v1/pos/price', $cart)->assertOk()
            ->assertJsonPath('data.invoice_discount.source', 'customer_group')
            ->assertJsonPath('data.invoice_discount_total', '5.00');

        $this->makePromotion($this->org, ['name' => '2 off', 'type' => 'fixed', 'value' => '2', 'channels' => ['till']]);
        $this->postJson('/api/v1/pos/price', $cart)->assertOk()
            ->assertJsonPath('data.invoice_discount.source', 'promotion')
            ->assertJsonPath('data.invoice_discount_total', '2.00');
        // The group discount sent back counts as the group's, so the promotion still wins.
        $this->postJson('/api/v1/pos/price', $cart + ['invoice_discount' => ['type' => 'percent', 'value' => '5']])->assertOk()
            ->assertJsonPath('data.invoice_discount.source', 'promotion');
    }

    public function test_per_customer_limits_count_the_sales_customer(): void
    {
        $this->soapSale(['usage_limit_per_customer' => 1]);
        $buyer = $this->customer($this->org, 'Buyer');
        $this->actingAsUser($this->cashier);
        $cart = $this->cart($this->store, [[$this->soap, '1']], [['cash', '100.00']], ['customer_id' => $buyer->id]);

        $this->checkout($cart)->assertCreated()->assertJsonPath('data.total', '90.00');
        $this->postJson('/api/v1/pos/price', $cart)->assertOk()->assertJsonPath('data.lines.0.promotion', null)->assertJsonPath('data.total', '100.00');
        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$this->soap, '1']]))->assertOk()->assertJsonPath('data.total', '90.00');
    }

    public function test_another_organizations_promotions_and_coupons_do_not_apply(): void
    {
        ['organization' => $other] = $this->provisionTenant('Other Shop');
        $this->makePromotion($other, ['name' => 'Theirs', 'type' => 'percent', 'value' => '50', 'channels' => ['till']]);
        $theirCode = $this->makePromotion($other, ['name' => 'Their code', 'type' => 'percent', 'value' => '50', 'trigger' => 'coupon', 'channels' => ['till']]);
        $this->makeCoupon($other, $theirCode, 'THEIRS');
        $this->actingAsUser($this->cashier);

        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$this->soap, '1']], [], ['coupon_code' => 'THEIRS']))->assertOk()
            ->assertJsonPath('data.promotions', [])
            ->assertJsonPath('data.coupon.status', 'invalid')
            ->assertJsonPath('data.total', '100.00');
    }

    public function test_promotion_channels_in_the_admin_api(): void
    {
        $base = ['name' => 'Ten off', 'type' => 'fixed', 'value' => '10', 'scope' => 'order', 'trigger' => 'automatic'];
        $id = $this->postJson('/api/v1/promotions', $base)->assertCreated()->assertJsonPath('data.channels', ['online'])->json('data.id');
        $this->patchJson("/api/v1/promotions/{$id}", ['channels' => ['till', 'online', 'till']])->assertStatus(422)->assertJsonValidationErrors('channels.0', 'error.details');
        $this->patchJson("/api/v1/promotions/{$id}", ['channels' => ['till', 'online']])->assertOk()->assertJsonPath('data.channels', ['online', 'till']);
        $this->getJson('/api/v1/promotions')->assertOk()->assertJsonPath('data.0.channels', ['online', 'till']);
        $this->patchJson("/api/v1/promotions/{$id}", ['channels' => []])->assertStatus(422)->assertJsonValidationErrors('channels', 'error.details');
        $this->patchJson("/api/v1/promotions/{$id}", ['channels' => ['shop']])->assertStatus(422)->assertJsonValidationErrors('channels.0', 'error.details');

        // Free delivery: online only.
        $this->postJson('/api/v1/promotions', ['name' => 'Free ship', 'type' => 'free_shipping', 'scope' => 'order', 'trigger' => 'automatic', 'channels' => ['online', 'till']])
            ->assertStatus(422)->assertJsonValidationErrors(['channels' => 'Free delivery offers apply to the online store only.'], 'error.details');
        $ship = $this->postJson('/api/v1/promotions', ['name' => 'Free ship', 'type' => 'free_shipping', 'scope' => 'order', 'trigger' => 'automatic'])->assertCreated()->json('data.id');
        $this->patchJson("/api/v1/promotions/{$ship}", ['channels' => ['till']])->assertStatus(422)->assertJsonValidationErrors('channels', 'error.details');
        $this->patchJson("/api/v1/promotions/{$id}", ['type' => 'free_shipping'])->assertStatus(422)->assertJsonValidationErrors('channels', 'error.details');
    }
}
