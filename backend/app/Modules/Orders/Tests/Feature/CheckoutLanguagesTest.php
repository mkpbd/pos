<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/**
 * E12b at checkout: translated delivery methods, payment methods and promotions (staff
 * round trip and shopper reads), cart names in Bangla, orders that keep the shopper's
 * language but snapshot base-language names, the customer's preferred language and
 * localized geography.
 */
class CheckoutLanguagesTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
    }

    private function translate(): void
    {
        $this->actingAsUser($this->tenant['admin']);
        $method = $this->patchJson("/api/v1/shipping/methods/{$this->methods['inside']}", ['translations' => ['bn' => ['name' => 'হোম ডেলিভারি', 'description' => ' ']]])
            ->assertOk()->json('data');
        $this->assertSame(['bn' => ['name' => 'হোম ডেলিভারি']], $method['translations']);
        $this->assertSame('Home delivery', $method['name'], 'Staff read the base text.');
        $this->patchJson("/api/v1/shipping/methods/{$this->methods['inside']}", ['translations' => ['bn' => ['fee' => '10']]])
            ->assertUnprocessable()->assertJsonValidationErrors(['translations.bn'], 'error.details');

        $cod = collect($this->putJson('/api/v1/payment-gateways/cod', ['translations' => ['bn' => ['display_name' => 'ক্যাশ অন ডেলিভারি']]])->assertOk()->json('data'));
        $this->assertSame(['bn' => ['display_name' => 'ক্যাশ অন ডেলিভারি']], $cod['translations']);
        $this->putJson('/api/v1/payment-gateways/cod', ['translations' => ['bn' => ['display_name' => str_repeat('ক', 61)]]])
            ->assertUnprocessable()->assertJsonValidationErrors(['translations.bn.display_name'], 'error.details');

        $promotion = $this->postJson('/api/v1/promotions', [
            'name' => 'Shirt week', 'type' => 'percent', 'value' => '10', 'scope' => 'products', 'target_ids' => [$this->productId('SHIRT')],
            'trigger' => 'automatic', 'translations' => ['bn' => ['name' => 'শার্ট সপ্তাহ']],
        ])->assertCreated()->json('data');
        $this->assertSame(['bn' => ['name' => 'শার্ট সপ্তাহ']], $promotion['translations']);
        $this->getJson("/api/v1/promotions/{$promotion['id']}")->assertOk()->assertJsonPath('data.translations.bn.name', 'শার্ট সপ্তাহ');
        $this->postJson('/api/v1/promotions', ['name' => 'X', 'type' => 'percent', 'value' => '5', 'scope' => 'order', 'trigger' => 'automatic', 'translations' => ['bn' => ['code' => 'x']]])
            ->assertUnprocessable()->assertJsonValidationErrors(['translations.bn'], 'error.details');

        $this->putJson("/api/v1/online-catalog/products/{$this->productId('SHIRT')}", ['is_published' => true, 'is_featured' => false, 'translations' => ['bn' => ['name' => 'শার্ট']]])->assertOk();
        $this->asVisitor();
    }

    private function productId(string $sku): string
    {
        return (string) DB::table('product_variants')->where('id', $this->v[$sku])->value('product_id');
    }

    public function test_shoppers_check_out_in_bangla_and_orders_keep_the_language_with_base_snapshots(): void
    {
        $this->translate();

        $cart = $this->browse('POST', $this->storeUrl('cart/items?lang=bn'), ['variant_id' => $this->v['SHIRT'], 'quantity' => 1])->assertOk();
        $this->assertSame('শার্ট', $cart->json('data.items.0.product.name'));
        $this->assertSame('Shirt', $this->browse('GET', $this->storeUrl('cart'))->json('data.items.0.product.name'));

        $methods = $this->browse('GET', $this->storeUrl('shipping-methods?lang=bn&district_id='.self::DHAKA))->assertOk()->assertHeader('Content-Language', 'bn')->json('data');
        $this->assertSame(['হোম ডেলিভারি', null], [$methods[0]['name'], $methods[0]['description']]);
        $options = $this->browse('GET', $this->storeUrl('checkout/options?lang=bn'))->assertOk()->json('data.payment_methods');
        $this->assertSame(['ক্যাশ অন ডেলিভারি', 'Bank transfer'], array_column($options, 'display_name'));

        $preview = $this->previewCheckout(['address' => ['district_id' => self::DHAKA], 'shipping_method_id' => $this->methods['inside'], 'payment_method' => 'cod'], self::HOST)->json('data');
        $this->assertSame('Home delivery', $preview['shipping_methods'][0]['name']);
        $bn = $this->browse('POST', $this->storeUrl('checkout/preview?lang=bn'), ['address' => ['district_id' => self::DHAKA], 'shipping_method_id' => $this->methods['inside'], 'payment_method' => 'cod'])->assertOk()->json('data');
        $this->assertSame(['হোম ডেলিভারি', 'শার্ট সপ্তাহ', 'শার্ট'], [$bn['shipping_methods'][0]['name'], $bn['promotions'][0]['name'], $bn['lines'][0]['product']['name']]);
        $this->assertSame($preview['total'], $bn['total'], 'Money never depends on the language.');

        $placed = $this->browse('POST', $this->storeUrl('checkout?lang=bn'), $this->checkoutBody($bn['total']), ['Idempotency-Key' => 'bn-order-1'])->assertCreated();
        $this->assertSame('bn', $placed->json('data.order.locale'));
        $this->assertSame('ক্যাশ অন ডেলিভারি', $placed->json('data.order.payment_method_label'));
        $order = Order::query()->withoutGlobalScopes()->where('number', $placed->json('data.order.number'))->firstOrFail();
        $this->assertSame(['bn', 'Home delivery'], [$order->locale, $order->shipping_method_name]);
        $this->assertSame('Shirt', DB::table('order_lines')->where('order_id', $order->id)->value('product_name'));
        $this->assertSame('Shirt week', DB::table('order_promotions')->where('order_id', $order->id)->value('name'));
        $this->assertSame('Dhaka', DB::table('order_addresses')->where('order_id', $order->id)->value('district_name'));

        // Without ?lang the order is English.
        $this->clearBrowser();
        $this->addToCart('JUICE', 1);
        $total = $this->previewCheckout(['address' => ['district_id' => self::DHAKA], 'shipping_method_id' => $this->methods['inside'], 'payment_method' => 'cod'])->json('data.total');
        $en = $this->placeOrder($this->checkoutBody($total))->assertCreated();
        $this->assertSame('en', $en->json('data.order.locale'));
        $this->assertSame('en', Order::query()->withoutGlobalScopes()->where('number', $en->json('data.order.number'))->value('locale'));
    }

    public function test_customers_get_their_language_on_sign_up_and_sign_in(): void
    {
        $registered = $this->browse('POST', 'http://'.self::HOST.'/api/v1/store/account/register?lang=bn', [
            'name' => 'Rina Akter', 'email' => 'rina@example.test', 'password' => 'secret-pass1', 'password_confirmation' => 'secret-pass1',
        ])->assertCreated();
        $this->assertSame('bn', $registered->json('data.customer.preferred_locale'));
        $this->assertSame('bn', CustomerAccount::query()->withoutGlobalScopes()->where('email', 'rina@example.test')->value('preferred_locale'));

        $this->browse('POST', 'http://'.self::HOST.'/api/v1/store/account/logout')->assertSuccessful();
        $this->browse('POST', 'http://'.self::HOST.'/api/v1/store/account/login?lang=en', ['email' => 'rina@example.test', 'password' => 'secret-pass1'])
            ->assertOk()->assertJsonPath('data.customer.preferred_locale', 'en');
        $this->assertSame('en', CustomerAccount::query()->withoutGlobalScopes()->where('email', 'rina@example.test')->value('preferred_locale'));
    }

    public function test_geography_names_follow_the_language(): void
    {
        $en = $this->browse('GET', $this->storeUrl('geo/divisions'))->assertOk()->json('data');
        $bn = $this->browse('GET', $this->storeUrl('geo/divisions?lang=bn'))->assertOk()->assertHeader('Content-Language', 'bn')->json('data');
        $dhakaEn = collect($en)->firstWhere('id', self::DHAKA_DIVISION);
        $dhakaBn = collect($bn)->firstWhere('id', self::DHAKA_DIVISION);
        $this->assertSame('Dhaka', $dhakaEn['name']);
        $this->assertSame($dhakaEn['name_bn'], $dhakaBn['name']);
        $this->assertNotSame('Dhaka', $dhakaBn['name']);
        $districts = $this->browse('GET', $this->storeUrl('geo/districts?lang=bn&division='.self::DHAKA_DIVISION))->assertOk()->json('data');
        $this->assertSame(array_column($districts, 'name_bn'), array_column($districts, 'name'));
    }
}
