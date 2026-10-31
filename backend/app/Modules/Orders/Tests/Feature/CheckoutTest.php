<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\Cart\Infrastructure\Models\Cart;
use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Inventory\Infrastructure\Models\StockLevel;
use App\Modules\Inventory\Infrastructure\Models\StockMovement;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderLineStock;
use App\Modules\Orders\Infrastructure\Notifications\NewOnlineOrderNotification;
use App\Modules\Orders\Infrastructure\Notifications\OrderConfirmation;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Sales\Domain\SaleCalculator;
use App\Modules\Sales\Domain\TaxMode;
use App\Modules\Shared\Infrastructure\Persistence\IdempotencyKey;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Tests\TestCase;

class CheckoutTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
    }

    private function onlineMovements(?string $type = 'online_order'): int
    {
        return StockMovement::query()->withoutGlobalScopes()->where('type', $type)->count();
    }

    private function stockOf(string $sku): string
    {
        $levels = StockLevel::query()->withoutGlobalScopes()->where('variant_id', $this->v[$sku])->pluck('quantity')->all();

        return number_format(array_sum(array_map('floatval', $levels)), 3, '.', '');
    }

    public function test_guest_places_a_cash_on_delivery_order(): void
    {
        $this->addToCart('SHIRT', 2);
        $this->addToCart('JUICE', 2);
        $this->addToCart('RICE', 1);
        $cartId = $this->browse('GET', $this->storeUrl('cart'))->json('data.id');

        // Server totals = CartPricer/SaleCalculator + delivery: 900 + (240 + 36 VAT) + 60.50 + 60 delivery.
        $goods = SaleCalculator::calculate([
            ['quantity' => '2', 'unit_price' => '450.00', 'tax_rate' => '0', 'discount' => null],
            ['quantity' => '2', 'unit_price' => '120.00', 'tax_rate' => '15', 'discount' => null],
            ['quantity' => '1', 'unit_price' => '60.50', 'tax_rate' => '0', 'discount' => null],
        ], null, TaxMode::Exclusive, 'BDT');
        $this->assertSame('1236.50', $goods['total']);

        $preview = $this->previewCheckout(['address' => ['district_id' => self::DHAKA], 'shipping_method_id' => $this->methods['inside'], 'payment_method' => 'cod'])
            ->assertOk()->json('data');
        $this->assertSame(['1200.50', '36.00', '60.00', '0.00', '1296.50', 'BDT', false, $this->methods['inside'], 'cod', []], [
            $preview['subtotal'], $preview['tax_total'], $preview['shipping_total'], $preview['cod_fee'], $preview['total'],
            $preview['currency'], $preview['prices_include_tax'], $preview['shipping_method_id'], $preview['payment_method'], $preview['issues'],
        ]);
        $this->assertCount(3, $preview['lines']);
        $this->assertSame(['id', 'name', 'description', 'fee', 'free_over', 'cod_allowed', 'cod_fee', 'eta_min_days', 'eta_max_days'], array_keys($preview['shipping_methods'][0]));

        $key = (string) Str::uuid();
        $placed = $this->placeOrder($this->checkoutBody('1296.50'), $key)->assertCreated();
        $order = $placed->json('data.order');
        $token = $placed->json('data.access_token');
        $this->assertIsString($token);
        $this->assertSame('WEB-000001', $order['number']);
        $this->assertSame(['confirmed', 'Confirmed', 'unpaid', 'cod', 'Cash on delivery', null], [
            $order['status'], $order['status_label'], $order['payment_status'], $order['payment_method'], $order['payment_method_label'], $order['payment_instructions'],
        ]);
        $this->assertSame(['1200.50', '36.00', '60.00', '0.00', '1296.50'], [$order['subtotal'], $order['tax_total'], $order['shipping_total'], $order['cod_fee'], $order['total']]);
        $this->assertSame(['name' => 'Rina Akter', 'email' => 'rina@example.test', 'phone' => '01712345678'], $order['contact']);
        $this->assertSame([
            'recipient_name' => 'Rina Akter', 'phone' => '01712345678', 'division' => 'Dhaka', 'district' => 'Dhaka',
            'area' => 'Dhanmondi', 'address_line' => 'House 1, Road 2', 'postcode' => '1205',
        ], $order['shipping_address']);
        $this->assertSame(['Home delivery', 1, 2], [$order['shipping_method_name'], $order['eta_min_days'], $order['eta_max_days']]);
        $this->assertSame([
            'product_name' => 'Shirt', 'variant_name' => null, 'sku' => 'SHIRT', 'image_url' => null, 'quantity' => '2',
            'unit_price' => '450.00', 'line_total' => '900.00', 'product_url' => '/product/shirt',
        ], $order['lines'][0]);
        $this->assertSame([['status' => 'confirmed', 'label' => 'Confirmed']], array_map(fn ($h) => array_diff_key($h, ['at' => 1]), $order['history']));

        // Stock left the fulfilment store exactly once (untracked rice has no movement).
        $this->assertSame(2, $this->onlineMovements());
        $this->assertSame('3.000', $this->stockOf('SHIRT'));
        $this->assertSame('8.000', $this->stockOf('JUICE'));

        // The cart became the order and the guest cookie is gone.
        $this->assertNull($this->jar['cart_token'] ?? null);
        $cart = Cart::query()->withoutGlobalScopes()->findOrFail($cartId);
        $this->assertNotNull($cart->converted_order_id);
        $this->assertSame(0, $cart->items()->count());
        $this->browse('GET', $this->storeUrl('cart'))->assertOk()->assertJsonPath('data.items', []);

        /** @var Order $saved */
        $saved = Order::query()->withoutGlobalScopes()->firstOrFail();
        $this->assertNull($saved->customer_id);
        $this->assertSame(hash('sha256', $token), $saved->access_token_hash);
        $this->assertSame($this->tenant['store']->id, $saved->store_id);
        $this->assertSame('Ring the bell', $saved->notes);

        Notification::assertSentOnDemand(OrderConfirmation::class, function (OrderConfirmation $n, array $channels, AnonymousNotifiable $notifiable) use ($token) {
            return $notifiable->routes['mail'] === 'rina@example.test'
                && $n->orderUrl === 'http://'.self::HOST.'/order/WEB-000001?token='.$token
                && $n->order['total'] === '1296.50';
        });
        Notification::assertSentTo($this->tenant['admin'], NewOnlineOrderNotification::class, function (NewOnlineOrderNotification $n) use ($saved) {
            $data = $n->toArray($this->tenant['admin']);

            return $data['url'] === '/web-orders/'.$saved->id && $data['title'] === 'New online order WEB-000001';
        });

        // The confirmation page: with the token only.
        $this->browse('GET', $this->storeUrl('orders/WEB-000001?token='.$token))->assertOk()->assertJsonPath('data.number', 'WEB-000001');
        $this->browse('GET', $this->storeUrl('orders/WEB-000001?token=wrong'))->assertNotFound();
        $this->browse('GET', $this->storeUrl('orders/WEB-000001'))->assertNotFound();
        $this->browse('GET', $this->storeUrl('orders/WEB-000099?token='.$token))->assertNotFound();
    }

    public function test_placement_is_idempotent_and_scoped(): void
    {
        $this->addToCart('SHIRT', 1);
        $body = $this->checkoutBody('510.00');
        $key = (string) Str::uuid();

        $first = $this->placeOrder($body, $key)->assertCreated();
        $this->assertSame(1, Order::query()->withoutGlobalScopes()->count());
        $this->assertSame(1, $this->onlineMovements());

        $scope = IdempotencyKey::query()->where('key', $key)->value('scope');
        $this->assertStringStartsWith('cart:', $scope);
        $this->assertNull(IdempotencyKey::query()->where('key', $key)->value('user_id'));
        $this->assertSame('4.000', $this->stockOf('SHIRT'));
        $this->assertSame('WEB-000001', $first->json('data.order.number'));

        // A guest without a cart has nothing to check out.
        $this->clearBrowser();
        $this->placeOrder($body, $key)->assertStatus(422)->assertJsonPath('error.code', 'CART_EMPTY');

        // Another guest may use the same key: keys belong to a cart, so this is a new order.
        $this->addToCart('SHIRT', 1);
        $this->placeOrder($body, $key)->assertCreated()->assertJsonPath('data.order.number', 'WEB-000002');
        $this->assertSame(2, $this->onlineMovements());
        $this->assertSame(2, IdempotencyKey::query()->where('key', $key)->count());
    }

    public function test_a_replay_with_the_same_cart_cookie_returns_the_first_order(): void
    {
        $this->addToCart('SHIRT', 1);
        $cookie = $this->jar['cart_token'];
        $key = (string) Str::uuid();
        $first = $this->placeOrder($this->checkoutBody('510.00'), $key)->assertCreated();

        // The browser never saw the response, so it still holds the cart cookie and retries.
        $this->jar['cart_token'] = $cookie;
        $replay = $this->placeOrder($this->checkoutBody('510.00'), $key)->assertCreated()->assertHeader('Idempotent-Replayed', 'true');
        $this->assertSame($first->json('data'), $replay->json('data'));
        $this->assertSame(1, Order::query()->withoutGlobalScopes()->count());
        $this->assertSame(1, $this->onlineMovements());
        $this->assertSame('4.000', $this->stockOf('SHIRT'));

        // The same key for a different body is refused.
        $this->jar['cart_token'] = $cookie;
        $this->placeOrder($this->checkoutBody('999.00'), $key)->assertStatus(409)->assertJsonPath('error.code', 'IDEMPOTENCY_KEY_REUSED');
        // Without a key: 428.
        $this->browse('POST', $this->storeUrl('checkout'), $this->checkoutBody('510.00'))->assertStatus(428);
    }

    public function test_customer_places_a_bank_transfer_order_with_a_saved_address(): void
    {
        $this->registerShopper(self::HOST);
        $address = $this->browse('POST', $this->storeUrl('account/addresses'), $this->inlineAddress($this->otherDistrict, $this->otherDivision))->assertCreated()->json('data');
        $this->addToCart('JUICE', 1);

        // Outside Dhaka: 120 delivery; bank transfer has no COD fee.
        $preview = $this->previewCheckout(['shipping_address_id' => $address['id'], 'shipping_method_id' => $this->methods['outside'], 'payment_method' => 'bank_transfer'])->json('data');
        $this->assertSame(['120.00', '18.00', '120.00', '0.00', '258.00'], [$preview['subtotal'], $preview['tax_total'], $preview['shipping_total'], $preview['cod_fee'], $preview['total']]);

        $key = (string) Str::uuid();
        $placed = $this->placeOrder($this->checkoutBody('258.00', [
            'shipping_address_id' => $address['id'],
            'shipping_method_id' => $this->methods['outside'],
            'payment_method' => 'bank_transfer',
        ]), $key)->assertCreated();
        $this->assertNull($placed->json('data.access_token'));
        $order = $placed->json('data.order');
        $this->assertSame(['pending_payment', 'Awaiting payment', 'Pay to Test Bank, account 123.'], [$order['status'], $order['status_label'], $order['payment_instructions']]);
        $this->assertNotNull($order['expires_at']);
        $this->assertSame($address['district']['name'], $order['shipping_address']['district']);

        $saved = Order::query()->withoutGlobalScopes()->firstOrFail();
        $this->assertNotNull($saved->customer_id);
        $this->assertNotNull($saved->customer_account_id);
        $this->assertNull($saved->access_token_hash);
        $this->assertEqualsWithDelta(now()->addHours(48)->getTimestamp(), $saved->expires_at->getTimestamp(), 5);
        $this->assertStringStartsWith('customer:', IdempotencyKey::query()->where('key', $key)->value('scope'));

        // The owner sees it without a token; the customer's cart is empty and usable again.
        $this->browse('GET', $this->storeUrl('orders/'.$order['number']))->assertOk()->assertJsonPath('data.payment_method', 'bank_transfer');
        $this->browse('GET', $this->storeUrl('cart'))->assertJsonPath('data.items', []);
        $this->addToCart('JUICE', 1);
        $this->assertSame(2, Cart::query()->withoutGlobalScopes()->whereNotNull('customer_id')->count());

        // Replay for the customer scope: same order.
        $this->placeOrder($this->checkoutBody('258.00', [
            'shipping_address_id' => $address['id'],
            'shipping_method_id' => $this->methods['outside'],
            'payment_method' => 'bank_transfer',
        ]), $key)->assertCreated()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.order.number', $order['number']);

        // Signed out, the order is not visible without its (non-existent) token.
        $this->browse('POST', $this->storeUrl('account/logout'))->assertSuccessful();
        $this->browse('GET', $this->storeUrl('orders/'.$order['number']))->assertNotFound();
    }

    public function test_customer_can_save_the_inline_address(): void
    {
        $this->registerShopper(self::HOST);
        $this->addToCart('SHIRT', 1);
        $this->placeOrder($this->checkoutBody('510.00', ['save_address' => true]))->assertCreated();

        $addresses = $this->browse('GET', $this->storeUrl('account/addresses'))->json('data');
        $this->assertCount(1, $addresses);
        $this->assertSame(['01712345678', 'Dhanmondi'], [$addresses[0]['phone'], $addresses[0]['area']]);
    }

    public function test_cod_fee_free_delivery_and_tampered_totals(): void
    {
        // Outside Dhaka with COD: 120 delivery + 20 COD fee.
        $this->addToCart('SHIRT', 1);
        $outside = ['address' => $this->inlineAddress($this->otherDistrict, $this->otherDivision), 'shipping_method_id' => $this->methods['outside']];
        $preview = $this->previewCheckout($outside + ['payment_method' => 'cod'])->json('data');
        $this->assertSame(['120.00', '20.00', '590.00'], [$preview['shipping_total'], $preview['cod_fee'], $preview['total']]);

        // Tampered expected total → 409 with the fresh preview; nothing happens.
        $this->placeOrder($this->checkoutBody('450.00', $outside))->assertStatus(409)
            ->assertJsonPath('error.code', 'TOTAL_CHANGED')
            ->assertJsonPath('error.details.total', '590.00')
            ->assertJsonPath('error.details.preview.total', '590.00');
        $this->assertSame(0, Order::query()->withoutGlobalScopes()->count());
        $this->assertSame(0, $this->onlineMovements());

        // Free delivery from 2000 (goods total): 5 shirts = 2250.
        $this->browse('PATCH', $this->storeUrl('cart/items/'.$this->browse('GET', $this->storeUrl('cart'))->json('data.items.0.id')), ['quantity' => 5])->assertOk();
        $free = $this->previewCheckout(['address' => ['district_id' => self::DHAKA], 'shipping_method_id' => $this->methods['inside'], 'payment_method' => 'cod'])->json('data');
        $this->assertSame(['0.00', '0.00', '2250.00'], [$free['shipping_total'], $free['cod_fee'], $free['total']]);
        $this->placeOrder($this->checkoutBody('2250.00'))->assertCreated()->assertJsonPath('data.order.shipping_total', '0.00');
    }

    public function test_preview_tolerates_partial_input(): void
    {
        $this->addToCart('SHIRT', 1);
        $preview = $this->previewCheckout([])->assertOk()->json('data');
        $this->assertSame(['450.00', '0.00', '0.00', '450.00', [], null, null], [
            $preview['subtotal'], $preview['shipping_total'], $preview['cod_fee'], $preview['total'],
            $preview['shipping_methods'], $preview['shipping_method_id'], $preview['payment_method'],
        ]);
        // A district without a zone: no methods, no error.
        $none = (int) \Illuminate\Support\Facades\DB::table('geo_districts')->whereNotIn('id', [self::DHAKA, $this->otherDistrict])->value('id');
        $this->previewCheckout(['address' => ['district_id' => $none], 'shipping_method_id' => $this->methods['inside']])->assertOk()
            ->assertJsonPath('data.shipping_methods', [])->assertJsonPath('data.shipping_method_id', null);
        $this->browse('GET', $this->storeUrl("shipping-methods?district_id={$none}"))->assertOk()->assertJsonPath('data', []);
        $this->browse('GET', $this->storeUrl('shipping-methods?district_id='.self::DHAKA))->assertOk()->assertJsonPath('data.0.name', 'Home delivery');
    }

    public function test_checkout_options(): void
    {
        $this->browse('GET', $this->storeUrl('checkout/options'))->assertOk()->assertJsonPath('data', [
            'available' => false,
            'reason' => 'cart_empty',
            'guest_checkout' => true,
            'payment_methods' => [
                ['code' => 'cod', 'display_name' => 'Cash on delivery', 'instructions_preview' => null],
                ['code' => 'bank_transfer', 'display_name' => 'Bank transfer', 'instructions_preview' => null],
            ],
            'signed_in' => false,
        ]);
        $this->addToCart('SHIRT', 1);
        $this->browse('GET', $this->storeUrl('checkout/options'))->assertJsonPath('data.available', true)->assertJsonPath('data.reason', null);
    }

    public function test_checkout_errors(): void
    {
        $this->addToCart('SHIRT', 1);

        // Unknown delivery method for the district.
        $this->placeOrder($this->checkoutBody('510.00', ['shipping_method_id' => $this->methods['outside']]))->assertStatus(422)
            ->assertJsonPath('error.code', 'SHIPPING_UNAVAILABLE')
            ->assertJsonPath('error.details.available_methods', [$this->methods['inside']]);

        // A district outside every zone.
        $none = (int) \Illuminate\Support\Facades\DB::table('geo_districts')->whereNotIn('id', [self::DHAKA, $this->otherDistrict])->first()->id;
        $division = (int) \Illuminate\Support\Facades\DB::table('geo_districts')->where('id', $none)->value('division_id');
        $this->placeOrder($this->checkoutBody('510.00', ['address' => $this->inlineAddress($none, $division)]))->assertStatus(422)
            ->assertJsonPath('error.code', 'SHIPPING_UNAVAILABLE');

        // Field errors (and the district must be in the division).
        $this->placeOrder(['payment_method' => 'card'])->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED')
            ->assertJsonStructure(['error' => ['details' => ['contact', 'address', 'shipping_method_id', 'payment_method', 'expected_total']]]);
        $this->placeOrder($this->checkoutBody('510.00', ['address' => $this->inlineAddress(self::DHAKA, $this->otherDivision === self::DHAKA_DIVISION ? 1 : $this->otherDivision)]))
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['address.district_id']]]);
        $this->placeOrder($this->checkoutBody('510.00', ['contact' => ['name' => 'X', 'email' => 'x@example.test', 'phone' => '12345']]))
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['contact.phone']]]);

        // Disabled payment method; COD not allowed by the delivery method; COD over the limit.
        $this->actingAsUser($this->tenant['admin']);
        $this->putJson('/api/v1/payment-gateways/bank_transfer', ['is_enabled' => false])->assertOk();
        $this->asVisitor();
        $this->placeOrder($this->checkoutBody('510.00', ['payment_method' => 'bank_transfer']))->assertStatus(422)->assertJsonPath('error.code', 'PAYMENT_METHOD_UNAVAILABLE');

        $this->actingAsUser($this->tenant['admin']);
        $this->patchJson("/api/v1/shipping/methods/{$this->methods['inside']}", ['cod_allowed' => false])->assertOk();
        $this->asVisitor();
        $this->placeOrder($this->checkoutBody('510.00'))->assertStatus(422)->assertJsonPath('error.code', 'PAYMENT_METHOD_UNAVAILABLE')->assertJsonPath('error.details.reason', 'delivery_method');
        $this->previewCheckout(['address' => ['district_id' => self::DHAKA], 'shipping_method_id' => $this->methods['inside'], 'payment_method' => 'cod'])
            ->assertJsonPath('data.payment_method', null);

        $this->actingAsUser($this->tenant['admin']);
        $this->patchJson("/api/v1/shipping/methods/{$this->methods['inside']}", ['cod_allowed' => true])->assertOk();
        $this->putJson('/api/v1/payment-gateways/cod', ['settings' => ['max_order_total' => '500']])->assertOk()->assertJsonPath('data.settings.max_order_total', '500.00');
        $this->asVisitor();
        $this->placeOrder($this->checkoutBody('510.00'))->assertStatus(422)->assertJsonPath('error.details.reason', 'max_order_total');

        $this->assertSame(0, Order::query()->withoutGlobalScopes()->count());
        $this->assertSame(0, $this->onlineMovements());
    }

    public function test_cart_issues_block_placement(): void
    {
        $this->addToCart('SHIRT', 3);
        $this->inTenant($this->tenant['organization'], fn () => app(\App\Modules\Inventory\Application\Actions\PostStockAdjustment::class)($this->tenant['admin']->fresh(), [
            'store_id' => $this->tenant['store']->id,
            'reason' => 'damage',
            'lines' => [['variant_id' => $this->v['SHIRT'], 'quantity' => '-4']],
        ]));
        $this->asVisitor();

        $this->placeOrder($this->checkoutBody('510.00'))->assertStatus(422)
            ->assertJsonPath('error.code', 'CART_HAS_ISSUES')
            ->assertJsonPath('error.details.cart.issues', ['exceeds_stock']);
        $this->assertSame(0, Order::query()->withoutGlobalScopes()->count());
    }

    public function test_checkout_unavailable_without_a_fulfilment_store(): void
    {
        $this->addToCart('SHIRT', 1);
        $this->actingAsUser($this->tenant['admin']);
        $this->patchJson('/api/v1/storefront/settings', ['fulfilment_store_id' => null])->assertOk();
        $this->asVisitor();

        $this->browse('GET', $this->storeUrl('checkout/options'))->assertJsonPath('data.reason', 'no_fulfilment_store');
        $this->previewCheckout([])->assertStatus(422)->assertJsonPath('error.code', 'CHECKOUT_UNAVAILABLE');
        $this->placeOrder($this->checkoutBody('510.00'))->assertStatus(422)->assertJsonPath('error.code', 'CHECKOUT_UNAVAILABLE');
    }

    public function test_guest_checkout_can_be_switched_off(): void
    {
        $this->actingAsUser($this->tenant['admin']);
        $this->patchJson('/api/v1/storefront/settings', ['guest_checkout_enabled' => false])->assertOk()->assertJsonPath('data.guest_checkout_enabled', false);
        $this->getJson('/api/v1/storefront/settings')->assertJsonPath('data.guest_checkout_enabled', false);
        $this->asVisitor();

        $this->addToCart('SHIRT', 1);
        $this->browse('GET', $this->storeUrl('checkout/options'))->assertJsonPath('data.guest_checkout', false);
        $this->placeOrder($this->checkoutBody('510.00'))->assertStatus(422)->assertJsonPath('error.code', 'GUEST_CHECKOUT_DISABLED');

        // Signing in (the guest cart merges) makes checkout possible.
        $this->registerShopper(self::HOST);
        $this->placeOrder($this->checkoutBody('510.00'))->assertCreated();
    }

    public function test_insufficient_stock_rolls_everything_back(): void
    {
        $this->addToCart('SHIRT', 2);
        $this->addToCart('JUICE', 1);
        // Someone else takes the shirts between pricing and posting (as a racing checkout would).
        $this->app->extend(StockLedger::class, fn (StockLedger $inner) => new class($inner) implements StockLedger
        {
            public function __construct(private readonly StockLedger $inner) {}

            public function post(array $changes, StockReference $reference): array
            {
                StockLevel::query()->where('variant_id', $changes[0]->variantId)->update(['quantity' => '1']);

                return $this->inner->post($changes, $reference);
            }
        });

        $key = (string) Str::uuid();
        $this->placeOrder($this->checkoutBody('1098.00'), $key)->assertStatus(422)
            ->assertJsonPath('error.code', 'INSUFFICIENT_STOCK')
            ->assertJsonPath('error.details.sku', 'SHIRT');

        $this->assertSame(0, Order::query()->withoutGlobalScopes()->count());
        $this->assertSame(0, $this->onlineMovements());
        $this->assertSame(0, OrderLineStock::query()->withoutGlobalScopes()->count());
        $this->assertSame('5.000', $this->stockOf('SHIRT'));
        $this->assertSame('10.000', $this->stockOf('JUICE'));
        $this->assertCount(2, $this->browse('GET', $this->storeUrl('cart'))->json('data.items'));
        // The failed attempt released its key.
        $this->assertSame(0, IdempotencyKey::query()->where('key', $key)->count());
    }

    public function test_web_orders_never_oversell_even_when_the_branch_allows_negative_stock(): void
    {
        $this->addToCart('SHIRT', 2);
        $this->inTenant($this->tenant['organization'], fn () => \App\Modules\Branches\Infrastructure\Models\Branch::query()->whereKey($this->tenant['store']->branch_id)->update(['allow_negative_stock' => true]));
        $this->app->extend(StockLedger::class, fn (StockLedger $inner) => new class($inner) implements StockLedger
        {
            public function __construct(private readonly StockLedger $inner) {}

            public function post(array $changes, StockReference $reference): array
            {
                StockLevel::query()->where('variant_id', $changes[0]->variantId)->update(['quantity' => '1']);

                return $this->inner->post($changes, $reference);
            }
        });

        $this->placeOrder($this->checkoutBody('960.00'))->assertStatus(422)->assertJsonPath('error.code', 'INSUFFICIENT_STOCK');
    }

    public function test_storefront_shell_knows_checkout_and_order_pages(): void
    {
        $shell = sys_get_temp_dir().'/storefront-shell-'.Str::random(6).'.html';
        file_put_contents($shell, '<html><head><title>x</title></head><body></body></html>');
        config(['storefront.shell_path' => $shell]);

        foreach (['/checkout', '/order/WEB-000123'] as $path) {
            $this->get('http://'.self::HOST.$path)->assertOk()->assertHeader('X-Robots-Tag', 'noindex');
        }
        $this->get('http://'.self::HOST.'/order/a/b')->assertNotFound();
        @unlink($shell);
    }
}
