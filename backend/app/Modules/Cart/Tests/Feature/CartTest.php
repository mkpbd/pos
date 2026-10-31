<?php

namespace App\Modules\Cart\Tests\Feature;

use App\Modules\Cart\Domain\CartRules;
use App\Modules\Cart\Infrastructure\Models\Cart;
use App\Modules\Catalog\Infrastructure\Models\TaxRate;
use App\Modules\Catalog\Infrastructure\Models\Unit;
use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\Inventory\Application\Actions\PostStockAdjustment;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Sales\Domain\SaleCalculator;
use App\Modules\Sales\Domain\TaxMode;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

class CartTest extends TestCase
{
    use ActsAsShopper, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const HOST = 'shop.example.test';

    /** @var array<string, mixed> */
    private array $tenant;

    /** @var array<string, string> variant ids */
    private array $v = [];

    /** @var array<string, string> product ids */
    private array $p = [];

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        config(['pos.auth_rate_limit' => 100]);
        $this->shop();
    }

    /**
     * Shirt (pcs): M 450 with 5 in stock, L 480 out of stock. Juice (pcs, VAT 15%): 120, compare-at 140,
     * 10 in stock. Rice (kg, decimals): 60.50, stock not tracked. Draft: not published.
     */
    private function shop(): void
    {
        $this->tenant = $t = $this->openStore('Berry Kids', self::HOST);
        $org = $t['organization'];
        $kg = $this->inTenant($org, fn () => Unit::query()->create(['name' => 'Kilogram', 'code' => 'kg', 'allow_decimal' => true]));
        $vat = $this->inTenant($org, fn () => TaxRate::query()->create(['name' => 'VAT', 'rate' => '15']));

        $shirt = $this->makeProduct($t['unit']->id, 'Shirt', [['SHIRT-M', '450.00', ['Size' => 'M']], ['SHIRT-L', '480.00', ['Size' => 'L']]], [
            'options' => [['name' => 'Size', 'values' => ['M', 'L']]],
        ]);
        $juice = $this->makeProduct($t['unit']->id, 'Juice', [['JUICE', '120.00']], ['tax_rate_id' => $vat->id]);
        $rice = $this->makeProduct($kg->id, 'Rice', [['RICE', '60.50']], ['track_stock' => false]);
        $draft = $this->makeProduct($t['unit']->id, 'Draft', [['DRAFT', '10.00']], ['track_stock' => false]);

        $this->publish($shirt['id']);
        $this->publish($juice['id'], ['variants' => [['variant_id' => $juice['variants'][0]['id'], 'compare_at_price' => '140.00']]]);
        $this->publish($rice['id']);
        $this->publish($draft['id'], ['is_published' => false]);

        $variants = fn (array $product) => array_column($product['variants'], 'id', 'sku');
        $this->v = [...$variants($shirt), ...$variants($juice), ...$variants($rice), ...$variants($draft)];
        $this->p = ['shirt' => $shirt['id'], 'juice' => $juice['id'], 'rice' => $rice['id'], 'draft' => $draft['id']];
        $this->stockUp($t, [$this->v['SHIRT-M'] => '5', $this->v['JUICE'] => '10']);
        $this->asVisitor();
    }

    private function url(string $path = 'cart', string $host = self::HOST): string
    {
        return "http://{$host}/api/v1/store/{$path}";
    }

    private function add(string $sku, string|int|float $quantity, string $host = self::HOST): TestResponse
    {
        return $this->browse('POST', $this->url('cart/items', $host), ['variant_id' => $this->v[$sku], 'quantity' => $quantity]);
    }

    private function line(array $cart, string $sku): array
    {
        return collect($cart['items'])->firstWhere('variant_id', $this->v[$sku]);
    }

    private function reduceStock(string $sku, string $quantity): void
    {
        $this->inTenant($this->tenant['organization'], fn () => app(PostStockAdjustment::class)($this->tenant['admin']->fresh(), [
            'store_id' => $this->tenant['store']->id,
            'reason' => 'damage',
            'lines' => [['variant_id' => $this->v[$sku], 'quantity' => '-'.$quantity]],
        ]));
    }

    public function test_guest_cart_lifecycle(): void
    {
        $empty = $this->browse('GET', $this->url())->assertOk()->json('data');
        $this->assertSame([
            'id' => null, 'items' => [], 'item_count' => '0', 'subtotal' => '0.00', 'tax_total' => '0.00', 'total' => '0.00',
            'prices_include_tax' => false, 'currency' => 'BDT', 'issues' => [],
        ], $empty);

        $added = $this->add('SHIRT-M', 2)->assertOk();
        $cookie = $added->getCookie('cart_token', false);
        $this->assertNotNull($cookie);
        $this->assertTrue($cookie->isHttpOnly());
        $this->assertSame('lax', $cookie->getSameSite());
        $this->assertGreaterThan(now()->addDays(29)->getTimestamp(), $cookie->getExpiresTime());
        $cart = $added->json('data');
        $this->assertNotNull($cart['id']);
        $this->assertSame(['id', 'variant_id', 'product', 'variant_name', 'option_values', 'sku', 'quantity', 'unit_price', 'compare_at_price', 'line_total', 'purchasable', 'in_stock', 'max_quantity', 'exceeds_stock', 'allow_decimal'], array_keys($cart['items'][0]));
        $this->assertSame([
            'variant_name' => 'M', 'option_values' => ['Size' => 'M'], 'sku' => 'SHIRT-M', 'quantity' => '2', 'unit_price' => '450.00',
            'compare_at_price' => null, 'line_total' => '900.00', 'purchasable' => true, 'in_stock' => true, 'max_quantity' => '5.000',
            'exceeds_stock' => false, 'allow_decimal' => false,
        ], array_intersect_key($cart['items'][0], array_flip(['variant_name', 'option_values', 'sku', 'quantity', 'unit_price', 'compare_at_price', 'line_total', 'purchasable', 'in_stock', 'max_quantity', 'exceeds_stock', 'allow_decimal'])));
        $this->assertSame(['id' => $this->p['shirt'], 'slug' => 'shirt', 'name' => 'Shirt', 'url' => '/product/shirt', 'image' => null], $cart['items'][0]['product']);
        $this->assertSame(['900.00', '0.00', '900.00', '2'], [$cart['subtotal'], $cart['tax_total'], $cart['total'], $cart['item_count']]);
        // The database keeps only a hash of the cookie token.
        $this->assertSame(1, Cart::query()->withoutGlobalScopes()->whereNotNull('token_hash')->whereNull('customer_id')->count());

        // Adding the same variant again adds to its line; the cookie is not reissued.
        $again = $this->add('SHIRT-M', 1)->assertOk();
        $this->assertNull($again->getCookie('cart_token', false));
        $this->assertSame('3', $this->line($again->json('data'), 'SHIRT-M')['quantity']);
        $this->assertSame($cart['id'], $again->json('data.id'));

        $itemId = $cart['items'][0]['id'];
        $this->browse('PATCH', $this->url("cart/items/{$itemId}"), ['quantity' => 1])->assertOk()
            ->assertJsonPath('data.items.0.quantity', '1')->assertJsonPath('data.total', '450.00');
        $this->browse('DELETE', $this->url("cart/items/{$itemId}"))->assertOk()->assertJsonPath('data.id', null)->assertJsonPath('data.items', []);
        $this->browse('DELETE', $this->url("cart/items/{$itemId}"))->assertNotFound();

        $this->add('JUICE', 1)->assertOk();
        $this->browse('DELETE', $this->url())->assertOk()->assertJsonPath('data.id', null)->assertJsonPath('data.total', '0.00');
        $this->assertSame(0, Cart::query()->withoutGlobalScopes()->count());
        $this->browse('GET', $this->url())->assertJsonPath('data.items', []);
    }

    public function test_adding_checks_the_catalog_and_the_stock(): void
    {
        $this->add('DRAFT', 1)->assertStatus(422)->assertJsonPath('error.code', 'VARIANT_NOT_PURCHASABLE');
        $this->add('SHIRT-L', 1)->assertStatus(422)->assertJsonPath('error.code', 'OUT_OF_STOCK');
        $this->add('SHIRT-M', 6)->assertStatus(422)->assertJsonPath('error.code', 'INSUFFICIENT_STOCK')
            ->assertJsonPath('error.details.max_quantity', '5.000');
        $this->add('SHIRT-M', 4)->assertOk();
        $this->add('SHIRT-M', 2)->assertStatus(422)->assertJsonPath('error.code', 'INSUFFICIENT_STOCK')
            ->assertJsonPath('error.details.max_quantity', '5.000')->assertJsonPath('error.details.in_cart', '4');

        $this->browse('POST', $this->url('cart/items'), ['variant_id' => (string) Str::uuid(), 'quantity' => 1])
            ->assertStatus(422)->assertJsonPath('error.code', 'VARIANT_NOT_PURCHASABLE');
        $this->browse('POST', $this->url('cart/items'), ['variant_id' => 'nope', 'quantity' => 1])->assertStatus(422)
            ->assertJsonValidationErrors(['variant_id'], 'error.details');

        // Quantities: positive, at most 999, three decimals, whole units unless the unit allows decimals.
        foreach ([0, -1, 1000, '1.2345', 'abc'] as $bad) {
            $this->add('RICE', $bad)->assertStatus(422)->assertJsonValidationErrors(['quantity'], 'error.details');
        }
        $this->add('JUICE', 1.5)->assertStatus(422)->assertJsonValidationErrors(['quantity'], 'error.details');
        $cart = $this->add('RICE', '1.25')->assertOk()->json('data');
        $this->assertSame(['1.25', true, '75.63', null], [
            $this->line($cart, 'RICE')['quantity'], $this->line($cart, 'RICE')['allow_decimal'], $this->line($cart, 'RICE')['line_total'], $this->line($cart, 'RICE')['max_quantity'],
        ]);
        $this->assertSame('5.25', $cart['item_count']);
        $this->add('RICE', 998)->assertStatus(422)->assertJsonValidationErrors(['quantity'], 'error.details');

        // A variant of another store is unknown here.
        $other = $this->openStore('Tiny Toes', 'tiny.example.test');
        $foreign = $this->makeProduct($other['unit']->id, 'Foreign', [['FOREIGN', '10.00']], ['track_stock' => false]);
        $this->publish($foreign['id']);
        $this->asVisitor();
        $this->browse('POST', $this->url('cart/items'), ['variant_id' => $foreign['variants'][0]['id'], 'quantity' => 1])
            ->assertStatus(422)->assertJsonPath('error.code', 'VARIANT_NOT_PURCHASABLE');
    }

    public function test_every_read_reprices_from_the_catalog(): void
    {
        $this->add('JUICE', 2)->assertOk()->assertJsonPath('data.subtotal', '240.00')
            ->assertJsonPath('data.items.0.compare_at_price', '140.00');

        DB::table('product_variants')->where('id', $this->v['JUICE'])->update(['selling_price' => '130.00']);

        $cart = $this->browse('GET', $this->url())->assertOk()->json('data');
        $this->assertSame(['130.00', '260.00', '260.00'], [$cart['items'][0]['unit_price'], $cart['items'][0]['line_total'], $cart['subtotal']]);
        $this->assertSame(['39.00', '299.00'], [$cart['tax_total'], $cart['total']]);
    }

    public function test_unavailable_lines_stay_flagged_and_do_not_count(): void
    {
        $this->add('JUICE', 1)->assertOk();
        $this->add('SHIRT-M', 1)->assertOk();
        $itemId = $this->add('RICE', 2)->json('data.items.2.id');

        DB::table('product_listings')->where('product_id', $this->p['juice'])->update(['is_published' => false]);
        DB::table('product_variants')->where('id', $this->v['RICE'])->update(['is_active' => false]);

        $cart = $this->browse('GET', $this->url())->assertOk()->json('data');
        $this->assertCount(3, $cart['items']);
        foreach (['JUICE', 'RICE'] as $sku) {
            $this->assertFalse($this->line($cart, $sku)['purchasable']);
            $this->assertSame('0.00', $this->line($cart, $sku)['line_total']);
        }
        $this->assertSame(['450.00', '0.00', '450.00', '1', ['unavailable']], [$cart['subtotal'], $cart['tax_total'], $cart['total'], $cart['item_count'], $cart['issues']]);

        $this->browse('PATCH', $this->url("cart/items/{$itemId}"), ['quantity' => 1])->assertStatus(422)->assertJsonPath('error.code', 'VARIANT_NOT_PURCHASABLE');
        $this->browse('DELETE', $this->url("cart/items/{$itemId}"))->assertOk()->assertJsonCount(2, 'data.items');
    }

    public function test_lines_above_the_stock_are_flagged_and_count_with_what_is_available(): void
    {
        $itemId = $this->add('SHIRT-M', 5)->json('data.items.0.id');
        $this->reduceStock('SHIRT-M', '3');

        $cart = $this->browse('GET', $this->url())->assertOk()->json('data');
        $line = $cart['items'][0];
        $this->assertSame(['5', true, '2.000', true, '900.00'], [$line['quantity'], $line['exceeds_stock'], $line['max_quantity'], $line['in_stock'], $line['line_total']]);
        $this->assertSame(['900.00', ['exceeds_stock'], '5'], [$cart['total'], $cart['issues'], $cart['item_count']]);

        $this->browse('PATCH', $this->url("cart/items/{$itemId}"), ['quantity' => 3])->assertStatus(422)->assertJsonPath('error.details.max_quantity', '2.000');
        $this->browse('PATCH', $this->url("cart/items/{$itemId}"), ['quantity' => 2])->assertOk()->assertJsonPath('data.items.0.exceeds_stock', false)->assertJsonPath('data.issues', []);

        $this->reduceStock('SHIRT-M', '2');
        $this->browse('GET', $this->url())->assertJsonPath('data.items.0.in_stock', false)->assertJsonPath('data.items.0.line_total', '0.00')
            ->assertJsonPath('data.total', '0.00')->assertJsonPath('data.issues', ['out_of_stock']);
        $this->browse('PATCH', $this->url("cart/items/{$itemId}"), ['quantity' => 1])->assertStatus(422)->assertJsonPath('error.code', 'OUT_OF_STOCK');
    }

    public function test_a_cart_holds_at_most_fifty_lines(): void
    {
        $this->add('RICE', 1)->assertOk();
        $cartId = Cart::query()->withoutGlobalScopes()->sole()->id;
        $template = (array) DB::table('product_variants')->where('id', $this->v['RICE'])->first();
        $clones = [];
        for ($i = 0; $i < CartRules::MAX_LINES; $i++) {
            $id = (string) Str::uuid7();
            DB::table('product_variants')->insert(['id' => $id, 'sku' => "RICE-{$i}", 'sort_order' => $i + 1] + $template);
            $clones[] = $id;
        }
        foreach (array_slice($clones, 0, CartRules::MAX_LINES - 1) as $id) {
            DB::table('cart_items')->insert(['id' => (string) Str::uuid7(), 'cart_id' => $cartId, 'variant_id' => $id, 'quantity' => '1.000', 'created_at' => now(), 'updated_at' => now()]);
        }

        $this->browse('POST', $this->url('cart/items'), ['variant_id' => $clones[CartRules::MAX_LINES - 1], 'quantity' => 1])
            ->assertStatus(422)->assertJsonPath('error.code', 'CART_FULL');
        // More of a line that is already there is fine.
        $this->add('RICE', 1)->assertOk()->assertJsonCount(CartRules::MAX_LINES, 'data.items');
    }

    public function test_totals_equal_the_sale_calculator_in_both_tax_modes(): void
    {
        $this->add('JUICE', 3)->assertOk();
        $this->add('SHIRT-M', 1)->assertOk();
        $cart = $this->add('RICE', '1.5')->assertOk()->json('data');

        $lines = [
            ['quantity' => '3.000', 'unit_price' => '120.00', 'tax_rate' => '15.0000', 'discount' => null],
            ['quantity' => '1.000', 'unit_price' => '450.00', 'tax_rate' => '0.0000', 'discount' => null],
            ['quantity' => '1.500', 'unit_price' => '60.50', 'tax_rate' => '0.0000', 'discount' => null],
        ];
        $exclusive = SaleCalculator::calculate($lines, null, TaxMode::Exclusive, 'BDT');
        $this->assertSame([$exclusive['subtotal'], $exclusive['tax_total'], $exclusive['total'], false], [$cart['subtotal'], $cart['tax_total'], $cart['total'], $cart['prices_include_tax']]);
        $this->assertSame(['900.75', '54.00', '954.75'], [$cart['subtotal'], $cart['tax_total'], $cart['total']]);

        Organization::query()->whereKey($this->tenant['organization']->id)->update(['tax_mode' => 'inclusive']);
        $cart = $this->browse('GET', $this->url())->json('data');
        $inclusive = SaleCalculator::calculate($lines, null, TaxMode::Inclusive, 'BDT');
        $this->assertSame([$inclusive['subtotal'], $inclusive['tax_total'], $inclusive['total'], true], [$cart['subtotal'], $cart['tax_total'], $cart['total'], $cart['prices_include_tax']]);
        $this->assertSame(['900.75', '46.96', '900.75'], [$cart['subtotal'], $cart['tax_total'], $cart['total']]);
    }

    public function test_guest_cart_merges_into_the_customer_cart_on_sign_in(): void
    {
        $this->registerShopper(self::HOST, 'rina@example.test');
        $this->add('SHIRT-M', 4)->assertOk();
        $this->browse('POST', $this->url('account/logout'))->assertNoContent();
        $this->browse('GET', $this->url())->assertJsonPath('data.id', null);

        // As a guest in the same browser.
        $this->add('SHIRT-M', 3)->assertOk();
        $this->add('JUICE', 2)->assertOk();
        $guestCart = $this->add('RICE', '1.5')->assertOk()->json('data.id');
        $this->assertArrayHasKey('cart_token', $this->jar);

        $login = $this->browse('POST', $this->url('account/login'), ['email' => 'rina@example.test', 'password' => 'secret-pass1'])->assertOk();
        $this->assertSame(['merged_lines' => 3, 'capped_lines' => 1], $login->json('data.merge'));
        $this->assertTrue($login->getCookie('cart_token', false)?->isCleared() ?? false, 'cart cookie forgotten');
        $this->assertArrayNotHasKey('cart_token', $this->jar);
        $this->assertNull(Cart::query()->withoutGlobalScopes()->find($guestCart));
        $this->assertSame(1, Cart::query()->withoutGlobalScopes()->count());

        $cart = $this->browse('GET', $this->url())->assertOk()->json('data');
        $this->assertSame(['5', '2', '1.5'], [$this->line($cart, 'SHIRT-M')['quantity'], $this->line($cart, 'JUICE')['quantity'], $this->line($cart, 'RICE')['quantity']]);
        $this->assertSame([], $cart['issues']);

        // Signing in again without a guest cart merges nothing.
        $this->browse('POST', $this->url('account/logout'))->assertNoContent();
        $this->browse('POST', $this->url('account/login'), ['email' => 'rina@example.test', 'password' => 'secret-pass1'])
            ->assertJsonPath('data.merge', ['merged_lines' => 0, 'capped_lines' => 0]);
    }

    public function test_guest_cart_becomes_the_new_accounts_cart_on_registration(): void
    {
        $this->add('JUICE', 2)->assertOk();

        $data = $this->registerShopper(self::HOST, 'rina@example.test');

        $this->assertSame(['merged_lines' => 1, 'capped_lines' => 0], $data['merge']);
        $this->browse('GET', $this->url())->assertJsonPath('data.items.0.quantity', '2')->assertJsonPath('data.total', '276.00');
        $this->assertSame(1, Cart::query()->withoutGlobalScopes()->whereNotNull('customer_id')->count());
        $this->assertSame(0, Cart::query()->withoutGlobalScopes()->whereNull('customer_id')->count());
    }

    public function test_a_guest_cart_token_is_useless_on_another_store(): void
    {
        $this->openStore('Tiny Toes', 'tiny.example.test');
        $this->asVisitor();
        $berryCart = $this->add('JUICE', 2)->json('data.id');

        // The same cookie on the other store's host: that store has no such cart.
        $this->browse('GET', $this->url('cart', 'tiny.example.test'))->assertOk()->assertJsonPath('data.id', null);
        $itemId = Cart::query()->withoutGlobalScopes()->findOrFail($berryCart)->items()->value('id');
        $this->browse('DELETE', $this->url("cart/items/{$itemId}", 'tiny.example.test'))->assertNotFound();
        $this->browse('DELETE', $this->url('cart', 'tiny.example.test'))->assertOk();

        $this->browse('GET', $this->url())->assertJsonPath('data.id', $berryCart)->assertJsonPath('data.items.0.quantity', '2');
    }

    public function test_customers_cannot_touch_each_others_cart_lines(): void
    {
        $this->registerShopper(self::HOST, 'rina@example.test');
        $rinasLine = $this->add('JUICE', 1)->json('data.items.0.id');
        $this->browse('POST', $this->url('account/logout'))->assertNoContent();

        $this->registerShopper(self::HOST, 'karim@example.test');
        $this->browse('GET', $this->url())->assertJsonPath('data.items', []);
        $this->browse('PATCH', $this->url("cart/items/{$rinasLine}"), ['quantity' => 2])->assertNotFound();
        $this->browse('DELETE', $this->url("cart/items/{$rinasLine}"))->assertNotFound();
    }

    public function test_cart_writes_are_rate_limited(): void
    {
        for ($i = 0; $i < 60; $i++) {
            $this->add('RICE', 1)->assertOk();
        }
        $this->add('RICE', 1)->assertStatus(429);
        $this->browse('GET', $this->url())->assertOk();
    }

    public function test_prune_deletes_expired_guest_carts_only(): void
    {
        $this->add('JUICE', 1)->assertOk();
        $old = Cart::query()->withoutGlobalScopes()->sole()->id;
        $this->clearBrowser();
        $this->travel(31)->days();
        $this->add('JUICE', 1)->assertOk();
        $this->registerShopper(self::HOST, 'rina@example.test');
        $this->add('SHIRT-M', 1)->assertOk();
        $this->assertSame(2, Cart::query()->withoutGlobalScopes()->count());
        $this->clearBrowser();
        $this->add('RICE', 1)->assertOk();

        $this->artisan('cart:prune')->assertSuccessful();

        $this->assertNull(Cart::query()->withoutGlobalScopes()->find($old));
        $this->assertSame(2, Cart::query()->withoutGlobalScopes()->count());
        $this->assertSame(1, Cart::query()->withoutGlobalScopes()->whereNotNull('customer_id')->count());
    }

    public function test_cards_offer_the_single_variant_and_product_pages_the_unit_rule(): void
    {
        $cards = collect($this->getJson($this->url('products'))->assertOk()->json('data'))->keyBy('slug');
        $this->assertSame($this->v['JUICE'], $cards['juice']['default_variant_id']);
        $this->assertSame($this->p['juice'], $cards['juice']['id']);
        $this->assertNull($cards['shirt']['default_variant_id']);

        $this->getJson($this->url('products/rice'))->assertOk()->assertJsonPath('data.allow_decimal', true)->assertJsonPath('data.id', $this->p['rice']);
        $this->getJson($this->url('products/juice'))->assertOk()->assertJsonPath('data.allow_decimal', false);
    }
}
