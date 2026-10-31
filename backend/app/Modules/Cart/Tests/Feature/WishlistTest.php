<?php

namespace App\Modules\Cart\Tests\Feature;

use App\Modules\Cart\Domain\CartRules;
use App\Modules\Cart\Infrastructure\Models\Wishlist;
use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Tests\TestCase;

class WishlistTest extends TestCase
{
    use ActsAsShopper, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const URL = 'http://shop.example.test/api/v1/store/wishlist';

    /** @var array<string, array<string, mixed>> */
    private array $products = [];

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        config(['pos.auth_rate_limit' => 100]);

        $t = $this->openStore('Berry Kids', 'shop.example.test');
        $this->products = [
            'shirt' => $this->makeProduct($t['unit']->id, 'Shirt', [['SHIRT-M', '450.00', ['Size' => 'M']], ['SHIRT-L', '480.00', ['Size' => 'L']]], [
                'options' => [['name' => 'Size', 'values' => ['M', 'L']]], 'track_stock' => false,
            ]),
            'juice' => $this->makeProduct($t['unit']->id, 'Juice', [['JUICE', '120.00']], ['track_stock' => false]),
            'draft' => $this->makeProduct($t['unit']->id, 'Draft', [['DRAFT', '10.00']]),
        ];
        $this->publish($this->products['shirt']['id']);
        $this->publish($this->products['juice']['id']);
        $this->publish($this->products['draft']['id'], ['is_published' => false]);
        $this->asVisitor();
    }

    private function id(string $product): string
    {
        return $this->products[$product]['id'];
    }

    private function variant(string $product, int $index = 0): string
    {
        return $this->products[$product]['variants'][$index]['id'];
    }

    public function test_guests_keep_their_wishlist_in_the_browser(): void
    {
        $this->browse('GET', self::URL)->assertUnauthorized();
        $this->browse('POST', self::URL.'/items', ['product_id' => $this->id('juice')])->assertUnauthorized();
        $this->browse('POST', self::URL.'/merge', ['items' => []])->assertUnauthorized();
    }

    public function test_add_list_and_remove(): void
    {
        $this->registerShopper('shop.example.test');
        $this->browse('GET', self::URL)->assertOk()->assertJsonPath('data', ['items' => []]);

        $this->browse('POST', self::URL.'/items', ['product_id' => $this->id('juice')])->assertOk()->assertJsonCount(1, 'data.items');
        // Adding it again changes nothing.
        $this->browse('POST', self::URL.'/items', ['product_id' => $this->id('juice')])->assertOk()->assertJsonCount(1, 'data.items');
        $list = $this->browse('POST', self::URL.'/items', ['product_id' => $this->id('shirt'), 'variant_id' => $this->variant('shirt', 1)])->assertOk()->json('data.items');

        $this->assertCount(2, $list);
        $this->assertSame(['id', 'product', 'variant_id'], array_keys($list[0]));
        $shirt = collect($list)->firstWhere('product.slug', 'shirt');
        $juice = collect($list)->firstWhere('product.slug', 'juice');
        $this->assertSame($this->variant('shirt', 1), $shirt['variant_id']);
        $this->assertSame($this->id('juice'), $juice['product']['id']);
        $this->assertSame($this->variant('juice'), $juice['product']['default_variant_id']);
        $this->assertSame('120.00', $juice['product']['price']);
        $this->assertNull($juice['variant_id']);

        // Same product with and without a variant are separate entries.
        $this->browse('POST', self::URL.'/items', ['product_id' => $this->id('shirt')])->assertOk()->assertJsonCount(3, 'data.items');

        $this->browse('POST', self::URL.'/items', ['product_id' => $this->id('draft')])->assertStatus(422)->assertJsonValidationErrors(['product_id'], 'error.details');
        $this->browse('POST', self::URL.'/items', ['product_id' => (string) Str::uuid()])->assertStatus(422);
        $this->browse('POST', self::URL.'/items', ['product_id' => $this->id('shirt'), 'variant_id' => $this->variant('juice')])
            ->assertStatus(422)->assertJsonValidationErrors(['variant_id'], 'error.details');

        $this->browse('DELETE', self::URL.'/items/'.$juice['id'])->assertOk()->assertJsonCount(2, 'data.items');
        $this->browse('DELETE', self::URL.'/items/'.$juice['id'])->assertNotFound();
    }

    public function test_entries_of_products_no_longer_live_are_hidden_but_kept(): void
    {
        $this->registerShopper('shop.example.test');
        $this->browse('POST', self::URL.'/items', ['product_id' => $this->id('juice')])->assertOk();
        $this->browse('POST', self::URL.'/items', ['product_id' => $this->id('shirt')])->assertOk();

        DB::table('product_listings')->where('product_id', $this->id('juice'))->update(['is_published' => false]);
        $this->browse('GET', self::URL)->assertOk()->assertJsonCount(1, 'data.items')->assertJsonPath('data.items.0.product.slug', 'shirt');
        $this->assertSame(2, DB::table('wishlist_items')->count());

        DB::table('product_listings')->where('product_id', $this->id('juice'))->update(['is_published' => true]);
        $this->browse('GET', self::URL)->assertJsonCount(2, 'data.items');
    }

    public function test_merge_adds_the_browser_list_once(): void
    {
        $this->registerShopper('shop.example.test');
        $this->browse('POST', self::URL.'/items', ['product_id' => $this->id('juice')])->assertOk();

        $this->browse('POST', self::URL.'/merge', ['items' => [
            ['product_id' => $this->id('juice')],
            ['product_id' => $this->id('shirt'), 'variant_id' => $this->variant('shirt')],
            ['product_id' => $this->id('shirt'), 'variant_id' => $this->variant('shirt')],
            ['product_id' => $this->id('draft')],
            ['product_id' => (string) Str::uuid()],
            ['product_id' => $this->id('juice'), 'variant_id' => $this->variant('shirt')],
        ]])->assertOk()->assertJsonCount(2, 'data.items');
        $this->assertSame(2, DB::table('wishlist_items')->count());

        $tooMany = array_fill(0, CartRules::MAX_WISHLIST_MERGE + 1, ['product_id' => $this->id('juice')]);
        $this->browse('POST', self::URL.'/merge', ['items' => $tooMany])->assertStatus(422)->assertJsonValidationErrors(['items'], 'error.details');
        $this->browse('POST', self::URL.'/merge', ['items' => [['product_id' => 'x']]])->assertStatus(422);
    }

    public function test_a_wishlist_holds_at_most_two_hundred_entries(): void
    {
        $this->registerShopper('shop.example.test');
        $this->browse('POST', self::URL.'/items', ['product_id' => $this->id('juice')])->assertOk();
        $wishlist = Wishlist::query()->withoutGlobalScopes()->sole();

        // Fill up with variants of the juice (copies of its one variant).
        $template = (array) DB::table('product_variants')->where('id', $this->variant('juice'))->first();
        for ($i = 1; $i < CartRules::MAX_WISHLIST_ITEMS; $i++) {
            $id = (string) Str::uuid7();
            DB::table('product_variants')->insert(['id' => $id, 'sku' => "JUICE-{$i}", 'sort_order' => $i] + $template);
            DB::table('wishlist_items')->insert(['id' => (string) Str::uuid7(), 'wishlist_id' => $wishlist->id, 'product_id' => $this->id('juice'), 'variant_id' => $id, 'created_at' => now()]);
        }

        $this->browse('POST', self::URL.'/items', ['product_id' => $this->id('shirt')])->assertStatus(422)->assertJsonPath('error.code', 'WISHLIST_FULL');
        // Existing entries can still be "added" (no change), and merging just stops.
        $this->browse('POST', self::URL.'/items', ['product_id' => $this->id('juice')])->assertOk();
        $this->browse('POST', self::URL.'/merge', ['items' => [['product_id' => $this->id('shirt')]]])->assertOk();
        $this->assertSame(CartRules::MAX_WISHLIST_ITEMS, DB::table('wishlist_items')->count());
    }

    public function test_customers_have_separate_wishlists(): void
    {
        $this->registerShopper('shop.example.test', 'rina@example.test');
        $rinas = $this->browse('POST', self::URL.'/items', ['product_id' => $this->id('juice')])->json('data.items.0.id');
        $this->browse('POST', 'http://shop.example.test/api/v1/store/account/logout')->assertNoContent();

        $this->registerShopper('shop.example.test', 'karim@example.test');
        $this->browse('GET', self::URL)->assertJsonPath('data.items', []);
        $this->browse('DELETE', self::URL.'/items/'.$rinas)->assertNotFound();
        $this->assertSame(1, DB::table('wishlist_items')->count());
    }
}
