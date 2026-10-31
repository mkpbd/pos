<?php

namespace App\Modules\OnlineCatalog\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The online catalog inside the storefront: homepage sections, menus, the HTML shell and
 * the popularity projection.
 */
class StorefrontCatalogIntegrationTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
    }

    /**
     * @return array{0: array<string, mixed>, 1: array<string, string>}
     */
    private function shop(): array
    {
        $t = $this->openStore('Berry Kids', 'berry.test');
        $org = $t['organization'];
        $drinks = $this->category($org, 'Drinks');
        $snacks = $this->category($org, 'Snacks');
        $pran = $this->brand($org, 'Pran');
        $acme = $this->brand($org, 'Acme');
        $this->listCategory($drinks);
        $this->listCategory($snacks);
        $this->listBrand($pran);
        $this->listBrand($acme);

        $juice = $this->makeProduct($t['unit']->id, 'Juice', [['JUICE', '50.00']], ['category_id' => $drinks, 'brand_id' => $pran])['id'];
        $cola = $this->makeProduct($t['unit']->id, 'Cola', [['COLA', '40.00']], ['category_id' => $drinks, 'brand_id' => $acme])['id'];
        $chips = $this->makeProduct($t['unit']->id, 'Chips', [['CHIPS', '20.00']], ['category_id' => $snacks])['id'];
        $this->publish($juice, ['published_at' => now()->subDays(3)->toIso8601String()]);
        $this->publish($cola, ['published_at' => now()->subDays(2)->toIso8601String()]);
        $this->publish($chips, ['published_at' => now()->subDay()->toIso8601String()]);

        return [$t, compact('drinks', 'snacks', 'pran', 'acme', 'juice', 'cola', 'chips')];
    }

    private function section(array $payload): string
    {
        return $this->postJson('/api/v1/storefront/homepage-sections', $payload)->assertCreated()->json('data.id');
    }

    public function test_homepage_catalog_sections(): void
    {
        [$t, $ids] = $this->shop();

        $featured = $this->section(['type' => 'product_carousel', 'title' => 'Featured', 'config' => ['source' => 'featured', 'limit' => 4]]);
        $grid = $this->section(['type' => 'product_grid', 'config' => ['source' => 'category', 'category_id' => $ids['drinks'], 'columns' => 3]]);
        $manual = $this->section(['type' => 'product_carousel', 'config' => ['source' => 'manual'], 'item_ids' => [$ids['chips'], $ids['juice']]]);
        $tabs = $this->section(['type' => 'product_tabs', 'config' => ['tabs' => [
            ['label' => 'New', 'source' => 'new_arrivals'],
            ['label' => 'On sale', 'source' => 'on_sale'],
            ['label' => 'Snacks', 'source' => 'category', 'category_id' => $ids['snacks']],
        ], 'limit' => 4]]);
        $strip = $this->section(['type' => 'category_strip', 'config' => ['source' => 'manual'], 'item_ids' => [$ids['snacks'], $ids['drinks']]]);
        $brands = $this->section(['type' => 'brand_strip', 'config' => ['source' => 'all']]);

        // The admin sees the picked records with names.
        $this->getJson("/api/v1/storefront/homepage-sections/{$manual}")->assertOk()
            ->assertJsonPath('data.item_ids', [$ids['chips'], $ids['juice']])
            ->assertJsonPath('data.items.0.name', 'Chips');
        $types = collect($this->getJson('/api/v1/storefront/homepage-sections/types')->json('data'))->keyBy('type');
        $this->assertNull($types['product_grid']['banner_placement']);
        $this->assertSame(['type' => 'category', 'min' => 1, 'max' => 16], $types['category_strip']['manual_items']);

        $this->asVisitor();
        $home = collect($this->getJson('http://berry.test/api/v1/store/homepage')->assertOk()->json('data.sections'))->keyBy('id');
        $this->assertFalse($home->has($featured), 'A section without products is not rendered.');
        $this->assertSame(['Cola', 'Juice'], array_column($home[$grid]['products'], 'name'));
        $this->assertSame(3, $home[$grid]['config']['columns']);
        $this->assertSame(['Chips', 'Juice'], array_column($home[$manual]['products'], 'name'));
        $this->assertSame(['New', 'Snacks'], array_column($home[$tabs]['tabs'], 'label'), 'Empty tabs are dropped.');
        $this->assertSame(['Chips', 'Cola', 'Juice'], array_column($home[$tabs]['tabs'][0]['products'], 'name'));
        $this->assertSame([['snacks', '/category/snacks', 1], ['drinks', '/category/drinks', 2]], array_map(fn ($c) => [$c['slug'], $c['url'], $c['product_count']], $home[$strip]['categories']));
        $this->assertSame(['Acme', 'Pran'], array_column($home[$brands]['brands'], 'name'));
        $this->assertSame('/brand/acme', $home[$brands]['brands'][0]['url']);

        // Staff preview shows the empty section with state "empty".
        $this->actingAsUser($this->createUserWithRole($t['organization'], SystemRole::OnlineStoreManager));
        $preview = collect($this->getJson('http://berry.test/api/v1/store/homepage?preview=1')->json('data.sections'))->keyBy('id');
        $this->assertSame('empty', $preview[$featured]['state']);
        $this->assertSame([], $preview[$featured]['products']);

        // Featuring a product fills it.
        $this->actingAsUser($t['admin']);
        $this->publish($ids['cola'], ['is_featured' => true]);
        $this->asVisitor();
        $home = collect($this->getJson('http://berry.test/api/v1/store/homepage')->json('data.sections'))->keyBy('id');
        $this->assertSame(['Cola'], array_column($home[$featured]['products'], 'name'));
    }

    public function test_catalog_section_validation(): void
    {
        [$t, $ids] = $this->shop();
        $other = $this->openStore('Tiny Toes', 'tiny.test');
        $foreign = $this->makeProduct($other['unit']->id, 'Foreign', [['F', '1.00']])['id'];
        $this->actingAsUser($t['admin']);
        $url = '/api/v1/storefront/homepage-sections';

        $this->postJson($url, ['type' => 'product_carousel', 'config' => ['source' => 'manual']])
            ->assertUnprocessable()->assertJsonPath('error.code', 'SECTION_ITEMS_INVALID');
        $this->postJson($url, ['type' => 'product_carousel', 'config' => ['source' => 'manual'], 'item_ids' => [$foreign]])
            ->assertUnprocessable()->assertJsonPath('error.code', 'PRODUCT_NOT_FOUND');
        $this->postJson($url, ['type' => 'product_grid', 'config' => ['source' => 'category']])
            ->assertUnprocessable()->assertJsonValidationErrors('config.category_id', 'error.details');
        $this->postJson($url, ['type' => 'product_grid', 'config' => ['source' => 'category', 'category_id' => (string) Str::uuid()]])
            ->assertUnprocessable()->assertJsonPath('error.code', 'CATEGORY_NOT_FOUND');
        $this->postJson($url, ['type' => 'product_grid', 'config' => ['limit' => 30, 'columns' => 6, 'view_all_url' => 'javascript:alert(1)']])
            ->assertUnprocessable()->assertJsonValidationErrors(['config.limit', 'config.columns', 'config.view_all_url'], 'error.details');
        $this->postJson($url, ['type' => 'product_tabs', 'config' => ['tabs' => [['label' => 'Only one', 'source' => 'featured']]]])
            ->assertUnprocessable()->assertJsonValidationErrors('config.tabs', 'error.details');
        $this->postJson($url, ['type' => 'product_tabs', 'config' => ['tabs' => [['label' => 'A', 'source' => 'manual'], ['label' => 'B', 'source' => 'category']]]])
            ->assertUnprocessable()->assertJsonValidationErrors(['config.tabs.0.source', 'config.tabs.1.category_id'], 'error.details');
        $this->postJson($url, ['type' => 'brand_strip', 'config' => ['source' => 'manual'], 'item_ids' => [$ids['drinks']]])
            ->assertUnprocessable()->assertJsonPath('error.code', 'BRAND_NOT_FOUND');
        $this->postJson($url, ['type' => 'newsletter', 'item_ids' => [$ids['juice']]])
            ->assertUnprocessable()->assertJsonValidationErrors('item_ids', 'error.details');

        // Switching away from the manual source drops the picks; non-manual sections accept `item_ids: []`.
        $id = $this->section(['type' => 'product_carousel', 'config' => ['source' => 'manual'], 'item_ids' => [$ids['juice']]]);
        $this->patchJson("{$url}/{$id}", ['config' => ['source' => 'featured'], 'item_ids' => []])->assertOk()->assertJsonPath('data.item_ids', []);
        $copy = $this->postJson("{$url}/{$id}/duplicate")->assertCreated()->json('data.id');
        $this->assertSame('featured', $this->getJson("{$url}/{$copy}")->json('data.config.source'));
    }

    public function test_menu_items_link_to_visible_categories_and_brands(): void
    {
        [$t, $ids] = $this->shop();
        $menu = $this->postJson('/api/v1/storefront/menus', ['name' => 'Main', 'location' => 'main'])->json('data.id');

        $targets = $this->getJson('/api/v1/storefront/link-targets')->assertOk()->json('data');
        $this->assertSame([['id' => $ids['drinks'], 'name' => 'Drinks', 'url' => '/category/drinks']], array_map(fn ($c) => array_intersect_key($c, ['id' => 1, 'name' => 1, 'url' => 1]), array_slice($targets['categories'], 0, 1)));
        $this->assertSame('/brand/pran', collect($targets['brands'])->firstWhere('id', $ids['pran'])['url']);

        $this->putJson("/api/v1/storefront/menus/{$menu}/items", ['items' => [
            ['type' => 'category', 'label' => 'Drinks', 'target_id' => (string) Str::uuid()],
        ]])->assertUnprocessable()->assertJsonPath('error.code', 'CATEGORY_NOT_FOUND');
        $this->putJson("/api/v1/storefront/menus/{$menu}/items", ['items' => [['type' => 'brand', 'label' => 'Pran']]])
            ->assertUnprocessable()->assertJsonValidationErrors('items.0.target_id', 'error.details');
        $this->putJson("/api/v1/storefront/menus/{$menu}/items", ['items' => [
            ['label' => 'Shop', 'url' => '/shop'],
            ['type' => 'category', 'label' => 'Drinks', 'target_id' => $ids['drinks'], 'is_mega' => true, 'children' => [
                ['type' => 'category', 'label' => 'Snacks', 'target_id' => $ids['snacks']],
            ]],
            ['type' => 'brand', 'label' => 'Pran', 'target_id' => $ids['pran']],
        ]])->assertOk();

        $this->asVisitor();
        $items = $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()->json('data.menus.main.items');
        $this->assertSame(['/shop', '/category/drinks', '/brand/pran'], array_column($items, 'url'));
        $this->assertSame('/category/snacks', $items[1]['children'][0]['url']);

        // Hidden listings hide their menu items.
        $this->actingAsUser($t['admin']);
        $this->listCategory($ids['snacks'], ['is_visible' => false]);
        $this->listBrand($ids['pran'], ['is_visible' => false]);
        $this->asVisitor();
        $items = $this->getJson('http://berry.test/api/v1/store/bootstrap')->json('data.menus.main.items');
        $this->assertSame(['/shop', '/category/drinks'], array_column($items, 'url'));
        $this->assertSame([], $items[1]['children']);
    }

    public function test_bootstrap_tells_whether_prices_include_tax(): void
    {
        $this->openStore('Berry Kids', 'berry.test');
        $this->asVisitor();

        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()
            ->assertJsonPath('data.store.prices_include_tax', false)
            ->assertJsonPath('data.store.currency', 'BDT');
    }

    public function test_shell_serves_catalog_pages_with_metadata(): void
    {
        [$t, $ids] = $this->shop();
        $this->postJson("/api/v1/products/{$ids['juice']}/images", ['image' => UploadedFile::fake()->image('juice.jpg', 300, 300)])->assertCreated();
        $this->publish($ids['juice'], ['seo_description' => 'Fresh mango juice.']);
        $this->asVisitor();

        $shell = tempnam(sys_get_temp_dir(), 'shell');
        file_put_contents($shell, '<!doctype html><html><head><title>Storefront</title></head><body><div id="root"></div></body></html>');
        config(['storefront.shell_path' => $shell]);

        $product = $this->get('http://berry.test/product/juice')->assertOk();
        $html = (string) $product->getContent();
        $this->assertStringContainsString('<title>Juice | Berry Kids</title>', $html);
        $this->assertStringContainsString('<meta property="og:type" content="product">', $html);
        $this->assertStringContainsString('<meta name="description" content="Fresh mango juice.">', $html);
        $this->assertMatchesRegularExpression('#<meta property="og:image" content="http://berry\.test/storage/products/[^"]+">#', $html);

        $this->get('http://berry.test/category/drinks')->assertOk()->assertSee('<title>Drinks | Berry Kids</title>', false);
        $this->get('http://berry.test/brand/pran')->assertOk()->assertSee('<title>Pran | Berry Kids</title>', false);
        $this->get('http://berry.test/shop')->assertOk()->assertHeader('X-Robots-Tag', 'all');
        $this->get('http://berry.test/search?q=juice')->assertOk()->assertHeader('X-Robots-Tag', 'noindex');
        $this->get('http://berry.test/product/nope')->assertNotFound();
        $this->get('http://berry.test/category/nope')->assertNotFound();

        $this->actingAsUser($t['admin']);
        $this->publish($ids['cola'], ['is_published' => false]);
        $this->asVisitor();
        $this->get('http://berry.test/product/cola')->assertNotFound();

        unlink($shell);
    }

    public function test_product_stats_command_feeds_popularity_and_best_sellers(): void
    {
        [$t, $ids] = $this->shop();
        $variant = fn (string $product) => DB::table('product_variants')->where('product_id', $product)->value('id');
        $sale = fn (string $product, string $qty, string $soldAt, string $status = 'completed') => $this->recordSale($t, $variant($product), $qty, $soldAt, $status);

        $sale($ids['chips'], '5', now()->subDays(2)->toDateTimeString());
        $sale($ids['chips'], '1.5', now()->subDays(40)->toDateTimeString());
        $sale($ids['cola'], '2', now()->subDay()->toDateTimeString());
        $sale($ids['juice'], '9', now()->subDay()->toDateTimeString(), 'cancelled');
        $returned = $sale($ids['cola'], '3', now()->subDays(3)->toDateTimeString());
        $this->recordReturn($t, $returned, '1');

        $this->artisan('storefront:refresh-product-stats')->assertSuccessful();
        $stats = DB::table('product_stats')->get()->keyBy('product_id');
        $this->assertEqualsCanonicalizing([$ids['chips'], $ids['cola']], $stats->keys()->all());
        $qty = fn ($value) => Decimal::round((string) $value, 3);
        $this->assertSame(['5.000', '6.500'], [$qty($stats[$ids['chips']]->units_sold_30d), $qty($stats[$ids['chips']]->units_sold_total)]);
        $this->assertSame('4.000', $qty($stats[$ids['cola']]->units_sold_30d));

        $this->asVisitor();
        $this->assertSame(['Chips', 'Cola', 'Juice'], array_column($this->getJson('http://berry.test/api/v1/store/products?sort=popularity')->json('data'), 'name'));

        // Running it again replaces the figures (idempotent).
        $this->artisan('storefront:refresh-product-stats', ['--organization' => $t['organization']->id])->assertSuccessful();
        $this->assertSame(2, DB::table('product_stats')->count());

        $this->actingAsUser($t['admin']);
        $id = $this->section(['type' => 'product_grid', 'config' => ['source' => 'best_sellers']]);
        $this->asVisitor();
        $home = collect($this->getJson('http://berry.test/api/v1/store/homepage')->json('data.sections'))->keyBy('id');
        $this->assertSame(['Chips', 'Cola'], array_column($home[$id]['products'], 'name'));
    }

    /**
     * A minimal completed POS sale line (the Sales module's tables, as the projection reads them).
     *
     * @param  array<string, mixed>  $t
     * @return array{sale: string, line: string, variant: string}
     */
    private function recordSale(array $t, string $variantId, string $quantity, string $soldAt, string $status): array
    {
        $org = $t['organization']->id;
        $sale = (string) Str::uuid();
        $line = (string) Str::uuid();
        $money = ['subtotal' => '0', 'item_discount_total' => '0', 'invoice_discount_total' => '0', 'tax_total' => '0', 'total' => '0',
            'paid_total' => '0', 'change_total' => '0', 'due_total' => '0', 'cost_total' => '0'];
        DB::table('sales')->insert($money + [
            'id' => $sale, 'organization_id' => $org, 'branch_id' => $t['branch']->id, 'store_id' => $t['store']->id,
            'number' => 'S-'.Str::random(6), 'status' => $status, 'tax_mode' => 'exclusive', 'currency' => 'BDT',
            'sold_at' => $soldAt, 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('sale_lines')->insert([
            'id' => $line, 'organization_id' => $org, 'sale_id' => $sale, 'position' => 1, 'variant_id' => $variantId,
            'product_name' => 'x', 'sku' => 'x', 'quantity' => $quantity, 'unit_price' => '1', 'line_subtotal' => '1',
            'discount_amount' => '0', 'invoice_discount_share' => '0', 'net_amount' => '1', 'tax_rate' => '0', 'tax_amount' => '0',
            'line_total' => '1', 'unit_cost' => '1', 'cost_total' => '1', 'created_at' => now(),
        ]);

        return ['sale' => $sale, 'line' => $line, 'variant' => $variantId];
    }

    /**
     * @param  array<string, mixed>  $t
     * @param  array{sale: string, line: string, variant: string}  $sale
     */
    private function recordReturn(array $t, array $sale, string $quantity): void
    {
        $return = (string) Str::uuid();
        DB::table('sale_returns')->insert([
            'id' => $return, 'organization_id' => $t['organization']->id, 'branch_id' => $t['branch']->id, 'store_id' => $t['store']->id,
            'sale_id' => $sale['sale'], 'number' => 'R-'.Str::random(6), 'status' => 'completed', 'currency' => 'BDT',
            'subtotal' => '0', 'tax_total' => '0', 'total' => '0', 'requested_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('sale_return_lines')->insert([
            'id' => (string) Str::uuid(), 'organization_id' => $t['organization']->id, 'sale_return_id' => $return, 'sale_line_id' => $sale['line'],
            'variant_id' => $sale['variant'], 'quantity' => $quantity, 'restock' => true, 'net_amount' => '0', 'tax_amount' => '0',
            'line_total' => '0', 'unit_cost' => '0', 'cost_total' => '0', 'created_at' => now(),
        ]);
    }
}
