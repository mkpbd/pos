<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\Cart\Infrastructure\Models\Cart;
use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\Inventory\Infrastructure\Models\StockLevel;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Notifications\NewOnlineOrderNotification;
use App\Modules\Orders\Infrastructure\Notifications\OrderConfirmation;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Shared\Infrastructure\Persistence\IdempotencyKey;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * P2a: the one-product order page — a landing page's `order_form` element orders directly
 * through the place-order use case (same pricing, stock, numbering, notifications), without
 * touching the cart; the form's rules are enforced by the server; idempotent; per store.
 */
class DirectCheckoutTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

    private string $document;

    private string $shirt;

    private string $juice;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
        $this->shirt = (string) DB::table('product_variants')->where('id', $this->v['SHIRT'])->value('product_id');
        $this->juice = (string) DB::table('product_variants')->where('id', $this->v['JUICE'])->value('product_id');
        $this->document = $this->landing('shirt-offer', self::orderForm($this->shirt, ['upsell' => ['product_id' => $this->juice, 'label' => 'Add a juice']]));
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private static function orderForm(string $productId, array $overrides = []): array
    {
        return ['id' => 'e_order', 'type' => 'order_form', 'props' => $overrides + [
            'product_id' => $productId,
            'title' => 'Order now',
            'quantity' => ['default' => 1, 'max' => 3],
            'fields' => ['email' => 'optional', 'note' => 'optional'],
            'payment' => 'cod_only',
            'button_label' => 'Confirm order',
            'success_message' => 'Thank you!',
        ], 'translations' => ['bn' => ['button_label' => 'অর্ডার নিশ্চিত করুন', 'upsell.label' => 'একটি জুস যোগ করুন']]];
    }

    /**
     * A published landing page with the element, created by the store's admin.
     *
     * @param  array<string, mixed>  $element
     */
    private function landing(string $slug, array $element, bool $publish = true, string $host = self::HOST): string
    {
        $this->clearBrowser();
        $this->actingAsUser($this->tenant['admin']);
        $id = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:'.$slug, 'title' => 'Offer'])->assertCreated()->json('data.id');
        $this->putJson(self::DOCS."/{$id}/draft", ['revision' => 0, 'content' => ['schema_version' => 1, 'sections' => [[
            'id' => 's_main', 'type' => 'section',
            'columns' => [['id' => 'c_main', 'width' => ['base' => 100], 'elements' => [$element]]],
        ]]]])->assertOk();
        if ($publish) {
            $this->postJson(self::DOCS."/{$id}/publish")->assertOk();
        }
        $this->asVisitor();

        return $id;
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function body(string $expectedTotal, array $overrides = []): array
    {
        return $overrides + [
            'document_id' => $this->document,
            'element_id' => 'e_order',
            'lines' => [['variant_id' => $this->v['SHIRT'], 'quantity' => 2], ['variant_id' => $this->v['JUICE'], 'quantity' => 1]],
            'contact' => ['name' => 'Rina Akter', 'phone' => '+880 1712-345678'],
            'address' => ['district_id' => self::DHAKA, 'area' => 'Dhanmondi', 'address_line' => 'House 1, Road 2'],
            'shipping_method_id' => $this->methods['inside'],
            'payment_method' => 'cod',
            'note' => 'Call before coming',
            'expected_total' => $expectedTotal,
            'attribution' => [
                'utm_source' => 'Facebook', 'utm_medium' => 'cpc', 'utm_campaign' => 'Eid-Offer', 'short_link' => 'eid',
                'landing_path' => '/p/shirt-offer?fbclid=x', 'referrer_host' => 'm.facebook.com', 'secret' => 'dropped', 'utm_term' => ['bad'],
            ],
        ];
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function direct(array $body, ?string $key = null, string $host = self::HOST): TestResponse
    {
        return $this->browse('POST', $this->storeUrl('checkout/direct', $host), $body, ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
    }

    private function stockOf(string $sku): string
    {
        $levels = StockLevel::query()->withoutGlobalScopes()->where('variant_id', $this->v[$sku])->pluck('quantity')->all();

        return number_format(array_sum(array_map('floatval', $levels)), 3, '.', '');
    }

    public function test_the_order_form_carries_product_checkout_and_delivery_data(): void
    {
        $page = $this->browse('GET', $this->storeUrl('builder/pages/shirt-offer'))->assertOk()->json('data');
        $data = $page['data']['e_order'];
        $this->assertSame($this->shirt, $data['product']['id']);
        $this->assertSame($this->juice, $data['upsell']['id']);
        $this->assertSame(['cod'], array_column($data['payment_methods'], 'code'));
        $this->assertTrue($data['cod_enabled']);
        $this->assertTrue($data['guest_checkout']);
        $this->assertTrue($data['checkout_available']);
        $this->assertSame([$this->methods['inside']], $data['shipping']['districts'][(string) self::DHAKA]);
        $this->assertEqualsCanonicalizing([$this->methods['inside'], $this->methods['outside']], array_column($data['shipping']['methods'], 'id'));

        // Bangla: the translated button and add-on label.
        $bn = $this->browse('GET', $this->storeUrl('builder/pages/shirt-offer?lang=bn'))->json('data');
        $element = $bn['sections'][0]['columns'][0]['elements'][0];
        $this->assertSame(['অর্ডার নিশ্চিত করুন', 'একটি জুস যোগ করুন'], [$element['props']['button_label'], $element['props']['upsell']['label']]);

        // A product that is not on sale: the form is left out of the published page.
        $this->actingAsUser($this->tenant['admin']);
        $this->putJson("/api/v1/online-catalog/products/{$this->shirt}", ['is_published' => false, 'is_featured' => false])->assertOk();
        $this->asVisitor();
        $this->clearBrowser();
        $page = $this->browse('GET', $this->storeUrl('builder/pages/shirt-offer'))->assertOk()->json('data');
        $this->assertArrayNotHasKey('e_order', $page['data']);
    }

    public function test_a_guest_orders_from_the_form_without_touching_the_cart(): void
    {
        // Something already in the guest's cart stays there.
        $this->addToCart('RICE', 1);
        $cartId = $this->browse('GET', $this->storeUrl('cart'))->json('data.id');

        // 2 × 450 + (120 + 18 VAT) + 60 delivery inside Dhaka; COD fee 0.
        $preview = $this->browse('POST', $this->storeUrl('checkout/direct/preview'), [
            'document_id' => $this->document, 'element_id' => 'e_order',
            'lines' => [['variant_id' => $this->v['SHIRT'], 'quantity' => 2], ['variant_id' => $this->v['JUICE'], 'quantity' => 1]],
            'address' => ['district_id' => self::DHAKA], 'payment_method' => 'cod',
        ])->assertOk()->json('data');
        $this->assertSame(['1020.00', '18.00', '60.00', '0.00', '1098.00', $this->methods['inside'], 'cod', []], [
            $preview['subtotal'], $preview['tax_total'], $preview['shipping_total'], $preview['cod_fee'], $preview['total'],
            $preview['shipping_method_id'], $preview['payment_method'], $preview['issues'],
        ]);
        $this->assertNull($preview['coupon_code']);

        $placed = $this->direct($this->body('1098.00'))->assertCreated()->json('data');
        $this->assertSame('WEB-000001', $placed['order']['number']);
        $this->assertSame('/order/WEB-000001?token='.$placed['access_token'], $placed['order_url']);
        $this->assertSame(['name' => 'Rina Akter', 'email' => null, 'phone' => '01712345678'], $placed['order']['contact']);
        $this->assertSame(['confirmed', 'cod', '1098.00'], [$placed['order']['status'], $placed['order']['payment_method'], $placed['order']['total']]);
        $this->assertSame(['Dhaka', 'Dhaka', 'Rina Akter', '01712345678'], [
            $placed['order']['shipping_address']['division'], $placed['order']['shipping_address']['district'],
            $placed['order']['shipping_address']['recipient_name'], $placed['order']['shipping_address']['phone'],
        ]);

        /** @var Order $order */
        $order = Order::query()->withoutGlobalScopes()->firstOrFail();
        $this->assertSame('landing_page', $order->source);
        // jsonb keeps its own key order.
        $this->assertEquals([
            'utm_source' => 'facebook', 'utm_medium' => 'cpc', 'utm_campaign' => 'eid-offer', 'short_link' => 'eid',
            'landing_path' => '/p/shirt-offer', 'referrer_host' => 'm.facebook.com', 'order_page' => '/p/shirt-offer',
        ], $order->attribution);
        $this->assertNull($order->contact_email);
        $this->assertSame('Call before coming', $order->notes);
        $this->assertSame('3.000', $this->stockOf('SHIRT'));
        $this->assertSame('9.000', $this->stockOf('JUICE'));

        // The cart is untouched: same items, not converted.
        $cart = Cart::query()->withoutGlobalScopes()->findOrFail($cartId);
        $this->assertNull($cart->converted_order_id);
        $this->assertSame(1, $cart->items()->count());

        // No e-mail address: no confirmation e-mail; staff are told.
        Notification::assertSentOnDemandTimes(OrderConfirmation::class, 0);
        Notification::assertSentTo($this->tenant['admin'], NewOnlineOrderNotification::class);

        // Staff see the source and the attribution.
        $this->actingAsUser($this->tenant['admin']);
        $detail = $this->getJson("/api/v1/web-orders/{$order->id}")->assertOk()->json('data');
        $this->assertSame(['landing_page', 'eid-offer', null], [$detail['source'], $detail['attribution']['utm_campaign'], $detail['campaign']]);
        $this->getJson('/api/v1/web-orders?source=landing_page')->assertJsonPath('meta.pagination.total', 1);
        $this->getJson('/api/v1/web-orders?source=storefront')->assertJsonPath('meta.pagination.total', 0);
    }

    public function test_placement_is_idempotent_per_session(): void
    {
        $key = (string) Str::uuid();
        $first = $this->direct($this->body('1098.00'), $key)->assertCreated();
        $replay = $this->direct($this->body('1098.00'), $key)->assertCreated()->assertHeader('Idempotent-Replayed', 'true');
        $this->assertSame($first->json('data'), $replay->json('data'));
        $this->assertSame(1, Order::query()->withoutGlobalScopes()->count());
        $this->assertSame('3.000', $this->stockOf('SHIRT'));
        $this->assertStringStartsWith('session:', (string) IdempotencyKey::query()->where('key', $key)->value('scope'));

        $this->direct($this->body('1098.00', ['note' => 'Another note']), $key)->assertStatus(409)->assertJsonPath('error.code', 'IDEMPOTENCY_KEY_REUSED');
        $this->browse('POST', $this->storeUrl('checkout/direct'), $this->body('1098.00'))->assertStatus(428);

        // Another visitor (another session) with the same key places its own order.
        $this->clearBrowser();
        $this->direct($this->body('1098.00'), $key)->assertCreated()->assertJsonPath('data.order.number', 'WEB-000002');
    }

    public function test_the_server_enforces_the_form_and_recomputes_the_total(): void
    {
        // A variant of another product.
        $this->direct($this->body('0', ['lines' => [['variant_id' => $this->v['RICE'], 'quantity' => 1]]]))
            ->assertStatus(422)->assertJsonValidationErrors('lines.0.variant_id', 'error.details');
        // Above the form's largest quantity; an add-on twice; no main product.
        $this->direct($this->body('0', ['lines' => [['variant_id' => $this->v['SHIRT'], 'quantity' => 4]]]))->assertStatus(422)->assertJsonValidationErrors('lines.0.quantity', 'error.details');
        $this->direct($this->body('0', ['lines' => [['variant_id' => $this->v['SHIRT'], 'quantity' => 1], ['variant_id' => $this->v['JUICE'], 'quantity' => 2]]]))
            ->assertStatus(422)->assertJsonValidationErrors('lines.1.quantity', 'error.details');
        $this->direct($this->body('0', ['lines' => [['variant_id' => $this->v['JUICE'], 'quantity' => 1]]]))->assertStatus(422)->assertJsonValidationErrors('lines', 'error.details');
        // Cash on delivery only.
        $this->direct($this->body('1098.00', ['payment_method' => 'bank_transfer']))->assertStatus(422)->assertJsonValidationErrors('payment_method', 'error.details');
        // Not a Bangladeshi mobile number.
        $this->direct($this->body('1098.00', ['contact' => ['name' => 'Rina', 'phone' => '12345']]))->assertStatus(422)->assertJsonValidationErrors('contact.phone', 'error.details');
        // A tampered total.
        $this->direct($this->body('100.00'))->assertStatus(409)->assertJsonPath('error.code', 'TOTAL_CHANGED')->assertJsonPath('error.details.total', '1098.00');
        // Unknown element and unknown document.
        $this->direct($this->body('1098.00', ['element_id' => 'e_other']))->assertStatus(422)->assertJsonPath('error.code', 'ORDER_FORM_UNAVAILABLE');
        $this->direct($this->body('1098.00', ['document_id' => (string) Str::uuid()]))->assertStatus(422)->assertJsonPath('error.code', 'ORDER_FORM_UNAVAILABLE');
        // More than the store has.
        $this->landing('big', self::orderForm($this->shirt, ['quantity' => ['default' => 1, 'max' => 20]]));
        $document = DB::table('builder_documents')->where('key', 'landing:big')->value('id');
        $this->direct($this->body('0', ['document_id' => $document, 'lines' => [['variant_id' => $this->v['SHIRT'], 'quantity' => 6]]]))
            ->assertStatus(422)->assertJsonPath('error.code', 'ITEMS_UNAVAILABLE')->assertJsonPath('error.details.issues', ['exceeds_stock']);

        $this->assertSame(0, Order::query()->withoutGlobalScopes()->count());
        $this->assertSame('5.000', $this->stockOf('SHIRT'));
    }

    public function test_email_and_note_follow_the_form(): void
    {
        $required = $this->landing('with-email', self::orderForm($this->shirt, ['fields' => ['email' => 'required', 'note' => 'hidden']]));
        $body = fn (array $o = []) => $this->body('510.00', $o + ['document_id' => $required, 'lines' => [['variant_id' => $this->v['SHIRT'], 'quantity' => 1]], 'note' => null]);

        $this->direct($body())->assertStatus(422)->assertJsonValidationErrors('contact.email', 'error.details');
        $this->direct($body(['note' => 'Hello', 'contact' => ['name' => 'Rina', 'phone' => '01712345678', 'email' => 'rina@example.test']]))
            ->assertStatus(422)->assertJsonValidationErrors('note', 'error.details');
        $this->direct($body(['contact' => ['name' => 'Rina', 'phone' => '01712345678', 'email' => 'rina@example.test']]))->assertCreated();
        Notification::assertSentOnDemand(OrderConfirmation::class);
    }

    public function test_drafts_and_other_stores_forms_are_not_available(): void
    {
        $draft = $this->landing('draft-offer', self::orderForm($this->shirt), publish: false);
        $this->direct($this->body('1098.00', ['document_id' => $draft]))->assertStatus(422)->assertJsonPath('error.code', 'ORDER_FORM_UNAVAILABLE');

        // Another organization's published order form is unknown on this store's host.
        $other = $this->openStore('Other Shop', 'other.example.test');
        $otherProduct = $this->makeProduct($other['unit']->id, 'Cap', [['CAP', '200.00']]);
        $this->publish($otherProduct['id']);
        $foreign = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:cap', 'title' => 'Cap'])->assertCreated()->json('data.id');
        $this->putJson(self::DOCS."/{$foreign}/draft", ['revision' => 0, 'content' => ['schema_version' => 1, 'sections' => [[
            'id' => 's_main', 'type' => 'section',
            'columns' => [['id' => 'c_main', 'width' => ['base' => 100], 'elements' => [self::orderForm($otherProduct['id'])]]],
        ]]]])->assertOk();
        $this->postJson(self::DOCS."/{$foreign}/publish")->assertOk();
        $this->clearBrowser();
        $this->asVisitor();

        $this->direct($this->body('200.00', ['document_id' => $foreign, 'lines' => [['variant_id' => $otherProduct['variants'][0]['id'], 'quantity' => 1]]]))
            ->assertStatus(422)->assertJsonPath('error.code', 'ORDER_FORM_UNAVAILABLE');
        // A form of this store cannot sell another store's product either (it is not saved with one).
        $this->clearBrowser();
        $this->actingAsUser($this->tenant['admin']);
        $id = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:foreign', 'title' => 'X'])->assertCreated()->json('data.id');
        $this->putJson(self::DOCS."/{$id}/draft", ['revision' => 0, 'content' => ['schema_version' => 1, 'sections' => [[
            'id' => 's_main', 'type' => 'section',
            'columns' => [['id' => 'c_main', 'width' => ['base' => 100], 'elements' => [self::orderForm($otherProduct['id'])]]],
        ]]]])->assertStatus(422)->assertJsonPath('error.code', 'DOCUMENT_INVALID');
    }

    public function test_the_cart_checkout_stores_its_attribution(): void
    {
        $this->addToCart('SHIRT', 1);
        $this->placeOrder($this->checkoutBody('510.00', ['attribution' => ['utm_source' => 'Instagram', 'landing_path' => 'not-a-path', 'short_link' => 'BAD CODE']]))->assertCreated();
        /** @var Order $order */
        $order = Order::query()->withoutGlobalScopes()->firstOrFail();
        $this->assertSame('storefront', $order->source);
        $this->assertSame(['utm_source' => 'instagram'], $order->attribution);

        $this->addToCart('SHIRT', 1);
        $this->placeOrder($this->checkoutBody('510.00', ['attribution' => 'nonsense']))->assertCreated();
        $this->assertNull(Order::query()->withoutGlobalScopes()->where('number', 'WEB-000002')->firstOrFail()->attribution);
    }
}
