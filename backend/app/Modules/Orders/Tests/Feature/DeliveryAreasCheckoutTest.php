<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderAddress;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * BD2a: every place that prices delivery passes the address's delivery area and the cart's
 * weight to ShippingRates — storefront checkout, saved addresses, staff orders and edits,
 * the landing-page order form — and the order keeps the area and the fee breakdown.
 *
 * Shop: Dhaka "Home delivery" 60, free from 2000, weight pricing 1 kg included + 25 per
 * started extra kg; Dhaka areas Gulshan +20, Savar −10 and an inactive one. Shirt 600 g,
 * Juice 1200 g (120 + 15% VAT), Rice without a weight.
 */
class DeliveryAreasCheckoutTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private string $gulshan;

    private string $savar;

    private string $closed;

    /** An area of a district no zone covers (neither Dhaka nor the other district). */
    private string $foreign;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
        $this->asAdmin();
        $area = fn (int $district, string $name, string $fee, bool $active = true) => $this->postJson('/api/v1/shipping/areas', [
            'district_id' => $district, 'name' => $name, 'fee_adjustment' => $fee, 'is_active' => $active,
        ])->assertCreated()->json('data.id');
        $this->gulshan = $area(self::DHAKA, 'Gulshan', '20');
        $this->savar = $area(self::DHAKA, 'Savar', '-10');
        $this->closed = $area(self::DHAKA, 'Closed area', '0', false);
        $third = (int) DB::table('geo_districts')->whereNotIn('id', [self::DHAKA, $this->otherDistrict])->orderBy('id')->value('id');
        $this->foreign = $area($third, 'Sadar', '15');
        $this->patchJson("/api/v1/shipping/methods/{$this->methods['inside']}", ['weight_included_kg' => '1', 'fee_per_extra_kg' => '25'])->assertOk();
        DB::table('product_variants')->where('id', $this->v['SHIRT'])->update(['weight_grams' => 600]);
        DB::table('product_variants')->where('id', $this->v['JUICE'])->update(['weight_grams' => 1200]);
        $this->asVisitor();
    }

    private function asAdmin(): void
    {
        $this->clearBrowser();
        $this->actingAsUser($this->tenant['admin']);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function address(?string $areaId, array $overrides = []): array
    {
        return array_replace($this->inlineAddress(), ['area' => null, 'area_id' => $areaId], $overrides);
    }

    /**
     * @return array<string, mixed>
     */
    private function details(TestResponse $response): array
    {
        return $response->assertUnprocessable()->json('error.details');
    }

    public function test_checkout_prices_the_area_and_keeps_its_name(): void
    {
        $this->addToCart('SHIRT', 1);

        // Gulshan: 60 + 20; 600 g is within the included kg.
        $preview = $this->previewCheckout(['address' => ['district_id' => self::DHAKA, 'area_id' => $this->gulshan], 'payment_method' => 'cod'])->assertOk()->json('data');
        $this->assertSame(['80.00', '530.00'], [$preview['shipping_total'], $preview['total']]);
        $this->assertSame(['base_fee' => '60.00', 'area_adjustment' => '20.00', 'weight_fee' => '0.00'], $preview['shipping_breakdown']);
        $this->assertSame(['80.00', '60.00', '20.00', '0.00'], [
            $preview['shipping_methods'][0]['fee'], $preview['shipping_methods'][0]['base_fee'],
            $preview['shipping_methods'][0]['area_adjustment'], $preview['shipping_methods'][0]['weight_fee'],
        ]);
        // Savar is cheaper; an inactive or unknown area is ignored by the preview.
        $this->assertSame('50.00', $this->previewCheckout(['address' => ['district_id' => self::DHAKA, 'area_id' => $this->savar]])->json('data.shipping_total'));
        $this->assertSame('60.00', $this->previewCheckout(['address' => ['district_id' => self::DHAKA, 'area_id' => $this->closed]])->json('data.shipping_total'));
        $this->assertSame('60.00', $this->previewCheckout(['address' => ['district_id' => self::DHAKA]])->json('data.shipping_total'));

        $order = $this->placeOrder($this->checkoutBody('530.00', ['address' => $this->address($this->gulshan)]))->assertCreated()->json('data.order');
        $this->assertSame(['Gulshan', '80.00', '530.00'], [$order['shipping_address']['area'], $order['shipping_total'], $order['total']]);
        $this->assertSame(['base_fee' => '60.00', 'area_adjustment' => '20.00', 'weight_fee' => '0.00'], $order['shipping_breakdown']);
        $stored = OrderAddress::query()->withoutGlobalScopes()->firstOrFail();
        $this->assertSame(['Gulshan', $this->gulshan], [$stored->area, $stored->area_id]);
    }

    public function test_the_area_is_required_and_must_be_one_of_the_district(): void
    {
        $this->addToCart('SHIRT', 1);

        // Dhaka has areas: one of them is required (the free text alone is not enough).
        $this->assertArrayHasKey('address.area_id', $this->details($this->placeOrder($this->checkoutBody('510.00', ['address' => $this->address(null, ['area' => 'Dhanmondi'])]))));
        $this->assertArrayHasKey('address.area_id', $this->details($this->placeOrder($this->checkoutBody('510.00', ['address' => $this->address($this->closed)]))));
        $this->assertArrayHasKey('address.area_id', $this->details($this->placeOrder($this->checkoutBody('510.00', ['address' => $this->address($this->foreign)]))));
        $this->assertArrayHasKey('address.area_id', $this->details($this->placeOrder($this->checkoutBody('510.00', ['address' => $this->address('not-a-uuid')]))));
        // Another district's area is refused even where the district has no areas…
        // Outside: 120 delivery + 20 COD fee.
        $outside = $this->checkoutBody('590.00', [
            'address' => $this->address($this->foreign, ['district_id' => $this->otherDistrict, 'division_id' => $this->otherDivision, 'area' => 'Station Road']),
            'shipping_method_id' => $this->methods['outside'],
        ]);
        $this->assertArrayHasKey('address.area_id', $this->details($this->placeOrder($outside)));
        $this->assertSame(0, Order::query()->withoutGlobalScopes()->count());

        // …where the free-text area works as before.
        unset($outside['address']['area_id']);
        $order = $this->placeOrder($outside)->assertCreated()->json('data.order');
        $this->assertSame(['Station Road', null], [$order['shipping_address']['area'], OrderAddress::query()->withoutGlobalScopes()->value('area_id')]);
        $this->assertSame(['base_fee' => '120.00', 'area_adjustment' => '0.00', 'weight_fee' => '0.00'], $order['shipping_breakdown']);
    }

    public function test_a_heavy_cart_pays_per_started_extra_kg_and_free_over_still_applies(): void
    {
        // 2 × 1200 g = 2.4 kg: 2 started kg above the included one → 50; + Gulshan 20.
        $this->addToCart('JUICE', 2);
        $this->addToCart('RICE', 3);
        $preview = $this->previewCheckout(['address' => ['district_id' => self::DHAKA, 'area_id' => $this->gulshan]])->json('data');
        $this->assertSame(['base_fee' => '60.00', 'area_adjustment' => '20.00', 'weight_fee' => '50.00'], $preview['shipping_breakdown']);
        // 240 + 36 VAT + 181.50 rice + 130 delivery.
        $this->assertSame(['130.00', '587.50'], [$preview['shipping_total'], $preview['total']]);
        $this->placeOrder($this->checkoutBody('587.50', ['address' => $this->address($this->gulshan)]))->assertCreated()
            ->assertJsonPath('data.order.shipping_total', '130.00')
            ->assertJsonPath('data.order.shipping_breakdown.weight_fee', '50.00');

        // The store's method list is priced the same way (area + the cart's weight), before free-over.
        $this->addToCart('JUICE', 2);
        $method = $this->browse('GET', $this->storeUrl('shipping-methods?district_id='.self::DHAKA.'&area_id='.$this->gulshan))->assertOk()->json('data.0');
        $this->assertSame(['130.00', '60.00', '20.00', '50.00'], [$method['fee'], $method['base_fee'], $method['area_adjustment'], $method['weight_fee']]);
        $this->assertSame('110.00', $this->browse('GET', $this->storeUrl('shipping-methods?district_id='.self::DHAKA.'&area_id='.$this->foreign))->json('data.0.fee'));
        $this->browse('DELETE', $this->storeUrl('cart'))->assertSuccessful();
        $this->assertSame('60.00', $this->browse('GET', $this->storeUrl('shipping-methods?district_id='.self::DHAKA))->json('data.0.fee'));

        // Free from 2000: 5 shirts (3 kg) deliver free whatever the area and weight.
        $this->addToCart('SHIRT', 5);
        $preview = $this->previewCheckout(['address' => ['district_id' => self::DHAKA, 'area_id' => $this->gulshan]])->json('data');
        $this->assertSame(['0.00', '2250.00'], [$preview['shipping_total'], $preview['total']]);
        $this->assertSame(['base_fee' => '60.00', 'area_adjustment' => '20.00', 'weight_fee' => '50.00'], $preview['shipping_breakdown']);
    }

    public function test_a_saved_address_uses_the_area_of_the_same_name(): void
    {
        $this->registerShopper(self::HOST);
        $matching = $this->browse('POST', $this->storeUrl('account/addresses'), ['area' => 'gulshan '] + $this->inlineAddress())->assertCreated()->json('data.id');
        $unknown = $this->browse('POST', $this->storeUrl('account/addresses'), $this->inlineAddress())->assertCreated()->json('data.id');
        $this->addToCart('SHIRT', 1);

        $this->assertSame('80.00', $this->previewCheckout(['shipping_address_id' => $matching])->json('data.shipping_total'));
        $this->assertArrayHasKey('shipping_address_id', $this->details($this->placeOrder($this->checkoutBody('510.00', ['shipping_address_id' => $unknown]))));
        $this->placeOrder($this->checkoutBody('530.00', ['shipping_address_id' => $matching]))->assertCreated()->assertJsonPath('data.order.shipping_address.area', 'Gulshan');
        $this->assertSame($this->gulshan, OrderAddress::query()->withoutGlobalScopes()->value('area_id'));

        // An inline address saved with its chosen area keeps the area's name.
        $this->addToCart('SHIRT', 1);
        $this->placeOrder($this->checkoutBody('500.00', ['address' => $this->address($this->savar), 'save_address' => true]))->assertCreated();
        $this->assertContains('Savar', array_column($this->browse('GET', $this->storeUrl('account/addresses'))->json('data'), 'area'));
    }

    public function test_staff_orders_and_edits_price_the_area_and_weight(): void
    {
        $this->asAdmin();
        $lines = [['variant_id' => $this->v['SHIRT'], 'quantity' => '1']];
        $this->postJson('/api/v1/web-orders/quote', ['lines' => $lines, 'address' => ['district_id' => self::DHAKA, 'area_id' => $this->gulshan]])->assertOk()
            ->assertJsonPath('data.shipping_total', '80.00')
            ->assertJsonPath('data.shipping_breakdown.area_adjustment', '20.00');

        $body = [
            'contact' => ['name' => 'Karim Uddin', 'phone' => '01812345678'],
            'lines' => $lines,
            'address' => ['recipient_name' => 'Karim Uddin', 'phone' => '01812345678', 'division_id' => self::DHAKA_DIVISION, 'district_id' => self::DHAKA, 'area' => 'Mirpur', 'address_line' => 'House 9'],
            'shipping_method_id' => $this->methods['inside'],
            'payment_method' => 'cod',
            'channel' => 'phone',
            'expected_total' => '530.00',
        ];
        $enter = fn (array $b) => $this->postJson('/api/v1/web-orders', $b, ['Idempotency-Key' => (string) Str::uuid()]);
        $this->assertArrayHasKey('address.area_id', $this->details($enter($body)));
        $body['address']['area_id'] = $this->gulshan;
        $order = $enter($body)->assertCreated()->json('data');
        $this->assertSame(['Gulshan', $this->gulshan, '80.00'], [$order['shipping_address']['area'], $order['shipping_address']['area_id'], $order['shipping_total']]);

        // The edit re-prices delivery: Savar (−10) and 2 juices (2.4 kg → + 50): 100.
        $edit = ['lines' => [['variant_id' => $this->v['JUICE'], 'quantity' => '2']], 'expected_total' => '376.00'] + $body;
        $edit['address']['area_id'] = $this->savar;
        $put = fn (array $b) => $this->putJson("/api/v1/web-orders/{$order['id']}", $b, ['Idempotency-Key' => (string) Str::uuid()]);
        $this->assertArrayHasKey('address.area_id', $this->details($put(['address' => ['area_id' => $this->foreign] + $edit['address']] + $edit)));
        $edited = $put($edit)->assertOk()->json('data');
        $this->assertSame(['Savar', $this->savar, '100.00', '376.00'], [$edited['shipping_address']['area'], $edited['shipping_address']['area_id'], $edited['shipping_total'], $edited['total']]);
        $this->assertSame(['base_fee' => '60.00', 'area_adjustment' => '-10.00', 'weight_fee' => '50.00'], $edited['shipping_breakdown']);
    }

    public function test_the_landing_page_order_form_prices_the_area_and_weight(): void
    {
        $this->asAdmin();
        $shirt = (string) DB::table('product_variants')->where('id', $this->v['SHIRT'])->value('product_id');
        $docs = '/api/v1/storefront/builder/documents';
        $document = $this->postJson($docs, ['kind' => 'page', 'key' => 'landing:shirt', 'title' => 'Offer'])->assertCreated()->json('data.id');
        $this->putJson("{$docs}/{$document}/draft", ['revision' => 0, 'content' => ['schema_version' => 1, 'sections' => [[
            'id' => 's_main', 'type' => 'section',
            'columns' => [['id' => 'c_main', 'width' => ['base' => 100], 'elements' => [['id' => 'e_order', 'type' => 'order_form', 'props' => [
                'product_id' => $shirt, 'title' => 'Order now', 'quantity' => ['default' => 1, 'max' => 3],
                'fields' => ['email' => 'optional', 'note' => 'optional'], 'payment' => 'cod_only',
                'button_label' => 'Confirm order', 'success_message' => 'Thank you!',
            ]]]]],
        ]]]])->assertOk();
        $this->postJson("{$docs}/{$document}/publish")->assertOk();
        $this->asVisitor();

        // 2 shirts = 1.2 kg → + 25; Savar −10: 75.
        $form = ['document_id' => $document, 'element_id' => 'e_order', 'lines' => [['variant_id' => $this->v['SHIRT'], 'quantity' => 2]]];
        $preview = $this->browse('POST', $this->storeUrl('checkout/direct/preview'), $form + ['address' => ['district_id' => self::DHAKA, 'area_id' => $this->savar], 'payment_method' => 'cod'])->assertOk()->json('data');
        $this->assertSame(['75.00', '975.00'], [$preview['shipping_total'], $preview['total']]);
        $this->assertSame(['base_fee' => '60.00', 'area_adjustment' => '-10.00', 'weight_fee' => '25.00'], $preview['shipping_breakdown']);

        $place = fn (array $address) => $this->browse('POST', $this->storeUrl('checkout/direct'), $form + [
            'contact' => ['name' => 'Rina Akter', 'phone' => '01712345678'],
            'address' => $address + ['address_line' => 'House 1'],
            'shipping_method_id' => $this->methods['inside'], 'payment_method' => 'cod', 'expected_total' => '975.00',
        ], ['Idempotency-Key' => (string) Str::uuid()]);
        $this->assertArrayHasKey('address.area_id', $this->details($place(['district_id' => self::DHAKA, 'area' => 'Dhanmondi'])));
        $place(['district_id' => self::DHAKA, 'area_id' => $this->savar])->assertCreated()
            ->assertJsonPath('data.order.shipping_address.area', 'Savar')
            ->assertJsonPath('data.order.shipping_breakdown.weight_fee', '25.00');
        $this->assertSame($this->savar, OrderAddress::query()->withoutGlobalScopes()->value('area_id'));
    }

    public function test_the_public_areas_lookup_is_per_store(): void
    {
        $url = fn (int $district, string $host = self::HOST) => $this->storeUrl("shipping/areas?district_id={$district}", $host);

        // Active areas only, in order, without their fee adjustments.
        $this->assertSame([['id' => $this->gulshan, 'name' => 'Gulshan'], ['id' => $this->savar, 'name' => 'Savar']], $this->browse('GET', $url(self::DHAKA))->assertOk()->json('data'));
        $this->assertSame([], $this->browse('GET', $url($this->otherDistrict))->assertOk()->json('data'));
        $this->browse('GET', $this->storeUrl('shipping/areas'))->assertUnprocessable();

        // Another store sees only its own areas.
        $this->openStore('Second Shop', 'second.example.test');
        $banani = $this->postJson('/api/v1/shipping/areas', ['district_id' => self::DHAKA, 'name' => 'Banani'])->assertCreated()->json('data.id');
        $this->asVisitor();
        $this->assertSame([['id' => $banani, 'name' => 'Banani']], $this->browse('GET', $url(self::DHAKA, 'second.example.test'))->assertOk()->json('data'));
        $this->assertSame(['Gulshan', 'Savar'], array_column($this->browse('GET', $url(self::DHAKA))->json('data'), 'name'));
    }
}
