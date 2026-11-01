<?php

namespace App\Modules\OnlineCatalog\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class StoreCatalogTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    /** @var array<string, mixed> */
    private array $tenant;

    /** @var array<string, string> */
    private array $ids = [];

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
    }

    /**
     * Grocery > Beverages, Apparel; brands Pran and Acme; Size attribute (S, M, L);
     *   Mango Juice   Beverages, Pran, 120 (was 140), 10 in stock
     *   Orange Juice  Beverages, Acme, 80, out of stock
     *   Polo Shirt    Apparel, Acme, M 450 (3 in stock) / L 480 (none) / XL inactive
     *   Rice Bag      Grocery, Pran, 60, stock not tracked
     *   Secret        draft; Coming Soon scheduled for later.
     */
    private function fixture(bool $withFulfilment = true): void
    {
        $this->tenant = $t = $this->openStore('Berry Kids', 'berry.test', $withFulfilment);
        $org = $t['organization'];
        $unit = $t['unit']->id;

        $grocery = $this->category($org, 'Grocery');
        $beverages = $this->category($org, 'Beverages', $grocery);
        $apparel = $this->category($org, 'Apparel');
        $pran = $this->brand($org, 'Pran');
        $acme = $this->brand($org, 'Acme');
        foreach ([$grocery, $beverages, $apparel] as $id) {
            $this->listCategory($id);
        }
        $this->listBrand($pran);
        $this->listBrand($acme);
        $this->postJson('/api/v1/attributes', ['name' => 'Size', 'display' => 'button', 'is_filterable' => true, 'values' => [
            ['value' => 'S'], ['value' => 'M'], ['value' => 'L'],
        ]])->assertCreated();

        $mango = $this->makeProduct($unit, 'Mango Juice', [['MANGO-1', '120.00']], ['category_id' => $beverages, 'brand_id' => $pran]);
        $orange = $this->makeProduct($unit, 'Orange Juice', [['ORANGE-1', '80.00']], ['category_id' => $beverages, 'brand_id' => $acme]);
        $polo = $this->makeProduct($unit, 'Polo Shirt', [['POLO-M', '450.00', ['Size' => 'M']], ['POLO-L', '480.00', ['Size' => 'L']], ['POLO-XL', '500.00', ['Size' => 'XL']]], [
            'category_id' => $apparel, 'brand_id' => $acme, 'options' => [['name' => 'Size', 'values' => ['L', 'M', 'XL']]],
        ]);
        // The XL variant is inactive.
        $this->putJson("/api/v1/products/{$polo['id']}", [
            'name' => 'Polo Shirt', 'type' => 'standard', 'unit_id' => $unit, 'category_id' => $apparel, 'brand_id' => $acme,
            'options' => [['name' => 'Size', 'values' => ['L', 'M', 'XL']]],
            'variants' => array_map(fn (array $v) => [
                'id' => $v['id'], 'sku' => $v['sku'], 'purchase_price' => '1.00', 'selling_price' => $v['selling_price'],
                'option_values' => $v['option_values'], 'is_active' => $v['sku'] !== 'POLO-XL',
            ], $polo['variants']),
        ])->assertOk();
        $rice = $this->makeProduct($unit, 'Rice Bag', [['RICE-5', '60.00']], ['category_id' => $grocery, 'brand_id' => $pran, 'track_stock' => false]);
        $secret = $this->makeProduct($unit, 'Secret', [['SECRET', '10.00']]);
        $soon = $this->makeProduct($unit, 'Coming Soon', [['SOON', '10.00']]);

        $this->publish($mango['id'], ['variants' => [['variant_id' => $mango['variants'][0]['id'], 'compare_at_price' => '140.00']], 'published_at' => now()->subDay()->toIso8601String()]);
        $this->publish($orange['id'], ['published_at' => now()->subDays(2)->toIso8601String()]);
        $this->publish($polo['id'], ['published_at' => now()->subDays(3)->toIso8601String()]);
        $this->publish($rice['id'], ['published_at' => now()->subDays(4)->toIso8601String()]);
        $this->publish($secret['id'], ['is_published' => false]);
        $this->publish($soon['id'], ['published_at' => now()->addDay()->toIso8601String()]);

        $this->stockUp($t, [$mango['variants'][0]['id'] => '10', $polo['variants'][0]['id'] => '3']);

        $this->ids = [
            'grocery' => $grocery, 'beverages' => $beverages, 'apparel' => $apparel, 'pran' => $pran, 'acme' => $acme,
            'mango' => $mango['id'], 'orange' => $orange['id'], 'polo' => $polo['id'], 'rice' => $rice['id'], 'secret' => $secret['id'],
            'polo_m' => $polo['variants'][0]['id'], 'mango_variant' => $mango['variants'][0]['id'],
        ];
        $this->asVisitor();
    }

    private function list(string $query = ''): array
    {
        return $this->getJson('http://berry.test/api/v1/store/products'.($query === '' ? '' : '?'.$query))->assertOk()->json();
    }

    /**
     * @param  array<string, mixed>  $response
     * @return list<string>
     */
    private function names(array $response): array
    {
        return array_column($response['data'], 'name');
    }

    public function test_listing_cards_facets_and_default_order(): void
    {
        $this->fixture();
        $all = $this->list();

        $this->assertSame(['Mango Juice', 'Orange Juice', 'Polo Shirt', 'Rice Bag'], $this->names($all));
        $this->assertSame(['current_page' => 1, 'per_page' => 24, 'total' => 4, 'last_page' => 1], array_diff_key($all['meta'], ['request_id' => 1]));

        $mango = $all['data'][0];
        $this->assertSame('mango-juice', $mango['slug']);
        $this->assertSame('/product/mango-juice', $mango['url']);
        $this->assertSame('120.00', $mango['price']);
        $this->assertSame('120.00', $mango['price_max']);
        $this->assertSame('140.00', $mango['compare_at_price']);
        $this->assertTrue($mango['on_sale']);
        $this->assertSame(14, $mango['discount_percent']);
        $this->assertTrue($mango['in_stock']);
        $this->assertSame(['name' => 'Pran', 'slug' => 'pran'], $mango['brand']);
        $this->assertSame(['name' => 'Beverages', 'slug' => 'beverages'], $mango['category']);
        $this->assertSame(1, $mango['variant_count']);

        $polo = $all['data'][2];
        $this->assertSame(['450.00', '480.00', 2], [$polo['price'], $polo['price_max'], $polo['variant_count']]);
        $this->assertFalse($all['data'][1]['in_stock']);
        $this->assertTrue($all['data'][3]['in_stock'], 'Untracked products are always in stock.');

        $this->assertSame([['slug' => 'apparel', 'name' => 'Apparel', 'count' => 1], ['slug' => 'grocery', 'name' => 'Grocery', 'count' => 3]], $all['facets']['categories']);
        $this->assertSame([
            ['slug' => 'acme', 'name' => 'Acme', 'count' => 2, 'selected' => false],
            ['slug' => 'pran', 'name' => 'Pran', 'count' => 2, 'selected' => false],
        ], $all['facets']['brands']);
        $this->assertSame(['min' => '60.00', 'max' => '450.00'], $all['facets']['price']);
        $this->assertSame(['count' => 3], $all['facets']['in_stock']);
        $this->assertSame(['count' => 1], $all['facets']['on_sale']);
        $this->assertSame('size', $all['facets']['attributes'][0]['slug']);
        $this->assertSame([['value' => 'M', 'swatch_hex' => null, 'count' => 1, 'selected' => false], ['value' => 'L', 'swatch_hex' => null, 'count' => 1, 'selected' => false]], $all['facets']['attributes'][0]['values']);
        $this->assertSame(['category' => null, 'brand' => null, 'q' => null], $all['context']);
    }

    public function test_facets_are_disjunctive(): void
    {
        $this->fixture();

        $pran = $this->list('brand[]=pran');
        $this->assertSame(['Mango Juice', 'Rice Bag'], $this->names($pran));
        // Other brands keep their counts; the selected one is flagged.
        $this->assertSame([['acme', 2, false], ['pran', 2, true]], array_map(fn ($b) => [$b['slug'], $b['count'], $b['selected']], $pran['facets']['brands']));
        $this->assertSame(['slug' => 'pran', 'name' => 'Pran'], $pran['context']['brand']);
        // Other facets apply the brand filter.
        $this->assertSame(['count' => 1], $pran['facets']['on_sale']);
        $this->assertSame([], $pran['facets']['attributes']);
        $this->assertSame([['slug' => 'grocery', 'name' => 'Grocery', 'count' => 2]], $pran['facets']['categories']);

        $both = $this->list('brand[]=pran&brand[]=acme&brand[]=unknown');
        $this->assertSame(4, $both['meta']['total']);
        $this->assertNull($both['context']['brand']);

        $sized = $this->list('attr[size][]=m');
        $this->assertSame(['Polo Shirt'], $this->names($sized));
        $this->assertSame([['M', 1, true], ['L', 1, false]], array_map(fn ($v) => [$v['value'], $v['count'], $v['selected']], $sized['facets']['attributes'][0]['values']));
        $this->assertSame([['slug' => 'acme', 'name' => 'Acme', 'count' => 1, 'selected' => false]], $sized['facets']['brands']);

        // A selected value without matches stays listed with count 0.
        $none = $this->list('attr[size][]=s&brand[]=pran');
        $this->assertSame(0, $none['meta']['total']);
        $this->assertSame([['S', 0, true]], array_map(fn ($v) => [$v['value'], $v['count'], $v['selected']], $none['facets']['attributes'][0]['values']));
        $this->assertSame(['count' => 0, 'selected' => true], array_intersect_key($none['facets']['brands'][0], ['count' => 1, 'selected' => 1]));
    }

    public function test_price_stock_sale_filters_sorting_paging_and_search(): void
    {
        $this->fixture();

        $priced = $this->list('price_min=100&price_max=460');
        $this->assertSame(['Mango Juice', 'Polo Shirt'], $this->names($priced));
        $this->assertSame(['min' => '60.00', 'max' => '450.00'], $priced['facets']['price'], 'The price range ignores the price filter itself.');
        $this->assertSame(['count' => 2], $priced['facets']['in_stock']);

        $this->assertSame(['Mango Juice', 'Polo Shirt', 'Rice Bag'], $this->names($this->list('in_stock=1')));
        $this->assertSame(['Mango Juice'], $this->names($this->list('on_sale=1')));

        $this->assertSame(['Rice Bag', 'Orange Juice', 'Mango Juice', 'Polo Shirt'], $this->names($this->list('sort=price_asc')));
        $this->assertSame(['Polo Shirt', 'Mango Juice', 'Orange Juice', 'Rice Bag'], $this->names($this->list('sort=price_desc')));
        $this->assertSame(['Mango Juice', 'Orange Juice', 'Polo Shirt', 'Rice Bag'], $this->names($this->list('sort=latest')));
        $this->assertSame(['Mango Juice', 'Orange Juice', 'Polo Shirt', 'Rice Bag'], $this->names($this->list('sort=name')));

        $page = $this->list('per_page=12&page=2');
        $this->assertSame([], $page['data']);
        $this->assertSame(2, $page['meta']['current_page']);

        $this->getJson('http://berry.test/api/v1/store/products?per_page=5')->assertUnprocessable()->assertJsonValidationErrors('per_page', 'error.details');
        $this->getJson('http://berry.test/api/v1/store/products?price_min=1.5.5')->assertUnprocessable();
        $this->getJson('http://berry.test/api/v1/store/products?sort=stars')->assertUnprocessable();

        $this->assertSame(['Mango Juice', 'Orange Juice'], $this->names($this->list('q=JUICE')));
        $this->assertSame(['Polo Shirt'], $this->names($this->list('q=polo-m')));
        $this->assertSame(['Mango Juice', 'Rice Bag'], $this->names($this->list('q=pran')));
        $this->assertSame('juice', $this->list('q=juice')['context']['q']);
        $this->assertSame([], $this->list('q=100%25')['data']);
    }

    public function test_category_scope_includes_subcategories(): void
    {
        $this->fixture();

        $grocery = $this->list('category=grocery');
        $this->assertSame(['Mango Juice', 'Orange Juice', 'Rice Bag'], $this->names($grocery));
        $this->assertSame([['slug' => 'beverages', 'name' => 'Beverages', 'count' => 2]], $grocery['facets']['categories']);
        $this->assertSame(['slug' => 'grocery', 'name' => 'Grocery'], $grocery['context']['category']);

        $this->getJson('http://berry.test/api/v1/store/products?category=nope')->assertNotFound()->assertJsonPath('error.code', 'NOT_FOUND');
    }

    public function test_slugs_mode_returns_exactly_those_products_in_order(): void
    {
        $this->fixture();

        $result = $this->list('slugs=rice-bag,secret,mango-juice,unknown');
        $this->assertSame(['Rice Bag', 'Mango Juice'], $this->names($result));
        $this->assertNull($result['facets']);

        $this->getJson('http://berry.test/api/v1/store/products?slugs='.implode(',', array_map(fn ($i) => "p{$i}", range(1, 13))))->assertUnprocessable();
    }

    public function test_without_a_fulfilment_store_tracked_products_are_out_of_stock(): void
    {
        $this->fixture(withFulfilment: false);

        $this->assertSame(['Rice Bag'], $this->names($this->list('in_stock=1')));
    }

    public function test_product_page(): void
    {
        $this->fixture();
        $this->actingAsUser($this->tenant['admin']);
        $this->postJson("/api/v1/products/{$this->ids['polo']}/images", ['image' => UploadedFile::fake()->image('polo.jpg', 400, 400)])->assertCreated();
        $this->publish($this->ids['polo'], [
            'short_description' => 'Soft cotton.',
            'description_html' => '<p>Breathable <script>alert(1)</script>piqué.</p>',
            'specifications' => [['label' => 'Material', 'value' => 'Cotton']],
            'seo_title' => 'Polo shirts',
        ]);
        $this->asVisitor();

        $page = $this->getJson('http://berry.test/api/v1/store/products/polo-shirt')->assertOk()->json('data');
        $this->assertSame('Polo Shirt', $page['name']);
        $this->assertStringNotContainsString('script', $page['description_html']);
        $this->assertSame([['label' => 'Material', 'value' => 'Cotton']], $page['specifications']);
        $this->assertSame([['name' => 'Home', 'url' => '/'], ['name' => 'Apparel', 'url' => '/category/apparel'], ['name' => 'Polo Shirt', 'url' => null]], $page['breadcrumbs']);
        // Dictionary order (S, M, L) and only values of active variants.
        $this->assertSame([['name' => 'Size', 'slug' => 'size', 'display' => 'button', 'values' => [['value' => 'M', 'swatch_hex' => null], ['value' => 'L', 'swatch_hex' => null]]]], $page['options']);
        $this->assertSame(['POLO-M', 'POLO-L'], array_column($page['variants'], 'sku'));
        $this->assertSame([true, false], array_column($page['variants'], 'in_stock'));
        $this->assertSame([true, false], array_column($page['variants'], 'low_stock'));
        $this->assertSame($this->ids['polo_m'], $page['default_variant_id']);
        $this->assertSame(['450.00', '480.00'], [$page['price'], $page['price_max']]);
        $this->assertSame('pcs', $page['unit']);
        $this->assertSame('Polo shirts', $page['seo']['title']);
        $this->assertStringStartsWith('/storage/products/', $page['seo']['image_url']);
        $this->assertArrayNotHasKey('preview_state', $page);

        $mango = $this->getJson('http://berry.test/api/v1/store/products/mango-juice')->assertOk()->json('data');
        $this->assertSame(['140.00', true, 14, false], [$mango['variants'][0]['compare_at_price'], $mango['variants'][0]['on_sale'], $mango['variants'][0]['discount_percent'], $mango['variants'][0]['low_stock']]);

        $this->getJson('http://berry.test/api/v1/store/products/secret')->assertNotFound()->assertJsonPath('error.code', 'NOT_FOUND');
        $this->getJson('http://berry.test/api/v1/store/products/coming-soon')->assertNotFound();
        $this->getJson('http://berry.test/api/v1/store/products/secret?preview=1')->assertNotFound();

        // Staff of this store with storefront.view may preview drafts and scheduled products.
        $this->actingAsUser($this->createUserWithRole($this->tenant['organization'], SystemRole::OnlineStoreManager));
        $this->getJson('http://berry.test/api/v1/store/products/secret?preview=1')->assertOk()->assertJsonPath('data.preview_state', 'draft');
        $this->getJson('http://berry.test/api/v1/store/products/coming-soon?preview=1')->assertOk()->assertJsonPath('data.preview_state', 'scheduled');
        $this->getJson('http://berry.test/api/v1/store/products/secret')->assertNotFound();
    }

    public function test_related_products_fall_back_to_the_category(): void
    {
        $this->fixture();

        $related = $this->getJson('http://berry.test/api/v1/store/products/mango-juice/related')->assertOk()->json('data');
        $this->assertSame(['Orange Juice'], array_column($related['related'], 'name'));
        $this->assertSame([], $related['frequently_bought']);

        $this->actingAsUser($this->tenant['admin']);
        $this->putJson("/api/v1/online-catalog/products/{$this->ids['mango']}/related", [
            'related' => [$this->ids['polo'], $this->ids['secret']],
            'frequently_bought' => [$this->ids['rice']],
        ])->assertOk()->assertJsonPath('data.related.related.0.name', 'Polo Shirt');
        $this->asVisitor();

        $related = $this->getJson('http://berry.test/api/v1/store/products/mango-juice/related')->assertOk()->json('data');
        $this->assertSame(['Polo Shirt'], array_column($related['related'], 'name'), 'Unpublished picks drop out.');
        $this->assertSame(['Rice Bag'], array_column($related['frequently_bought'], 'name'));

        $this->getJson('http://berry.test/api/v1/store/products/secret/related')->assertNotFound();
    }

    public function test_search_suggestions(): void
    {
        $this->fixture();

        $this->assertSame(['products' => [], 'categories' => []], $this->getJson('http://berry.test/api/v1/store/search/suggest?q=j')->assertOk()->json('data'));

        $juice = $this->getJson('http://berry.test/api/v1/store/search/suggest?q=or')->assertOk()->json('data');
        // Names starting with the term come first.
        $this->assertSame(['Orange Juice'], array_column($juice['products'], 'name'));
        $this->assertSame(['slug' => 'orange-juice', 'name' => 'Orange Juice', 'url' => '/product/orange-juice', 'image' => null, 'price' => '80.00'], $juice['products'][0]);

        $this->assertSame([['slug' => 'beverages', 'name' => 'Beverages', 'url' => '/category/beverages']], $this->getJson('http://berry.test/api/v1/store/search/suggest?q=bev')->json('data.categories'));
        $this->assertSame(['Rice Bag'], array_column($this->getJson('http://berry.test/api/v1/store/search/suggest?q=ri')->json('data.products'), 'name'));
    }

    public function test_category_tree_brands_and_their_pages(): void
    {
        $this->fixture();

        $tree = $this->getJson('http://berry.test/api/v1/store/categories')->assertOk()->json('data');
        $this->assertSame(['apparel', 'grocery'], array_column($tree, 'slug'));
        $this->assertSame([1, 3], array_column($tree, 'product_count'));
        $this->assertSame([['beverages', 2]], array_map(fn ($c) => [$c['slug'], $c['product_count']], $tree[1]['children']));

        $category = $this->getJson('http://berry.test/api/v1/store/categories/beverages')->assertOk()->json('data');
        $this->assertSame([['name' => 'Home', 'url' => '/'], ['name' => 'Grocery', 'url' => '/category/grocery'], ['name' => 'Beverages', 'url' => null]], $category['breadcrumbs']);
        $this->assertSame(['title' => 'Beverages', 'description' => null], $category['seo']);

        // Hiding the parent re-attaches its children to the nearest visible ancestor (here: the root).
        $this->actingAsUser($this->tenant['admin']);
        $this->listCategory($this->ids['grocery'], ['is_visible' => false]);
        $this->asVisitor();
        $tree = $this->getJson('http://berry.test/api/v1/store/categories')->json('data');
        $this->assertSame(['apparel', 'beverages'], array_column($tree, 'slug'));
        $this->getJson('http://berry.test/api/v1/store/categories/grocery')->assertNotFound();
        $this->getJson('http://berry.test/api/v1/store/products?category=grocery')->assertNotFound();
        $this->assertSame(['name' => 'Grocery', 'slug' => null], $this->list('slugs=rice-bag')['data'][0]['category']);

        $brands = $this->getJson('http://berry.test/api/v1/store/brands')->assertOk()->json('data');
        $this->assertSame([['acme', 2], ['pran', 2]], array_map(fn ($b) => [$b['slug'], $b['product_count']], $brands));
        $this->getJson('http://berry.test/api/v1/store/brands/pran')->assertOk()->assertJsonPath('data.name', 'Pran')->assertJsonPath('data.seo.title', 'Pran');
        $this->getJson('http://berry.test/api/v1/store/brands/nope')->assertNotFound();
    }

    public function test_another_stores_host_never_shows_these_products(): void
    {
        $this->fixture();
        $this->openStore('Tiny Toes', 'tiny.test');
        $this->asVisitor();

        $this->assertSame([], $this->getJson('http://tiny.test/api/v1/store/products')->assertOk()->json('data'));
        $this->getJson('http://tiny.test/api/v1/store/products/mango-juice')->assertNotFound();
        $this->getJson('http://tiny.test/api/v1/store/categories/beverages')->assertNotFound();
        $this->assertSame([], $this->getJson('http://tiny.test/api/v1/store/search/suggest?q=juice')->json('data.products'));
        $this->assertSame([], $this->getJson('http://tiny.test/api/v1/store/products?slugs=mango-juice')->json('data'));
    }

    public function test_a_price_change_shows_everywhere(): void
    {
        $this->fixture();
        $this->actingAsUser($this->tenant['admin']);
        $this->postJson('/api/v1/storefront/homepage-sections', ['type' => 'product_carousel', 'title' => 'Picks', 'config' => ['source' => 'manual'], 'item_ids' => [$this->ids['orange']]])->assertCreated();

        // Brief check 9: the admin changes the price in the product editor.
        $product = $this->getJson("/api/v1/products/{$this->ids['orange']}")->json('data');
        $this->putJson("/api/v1/products/{$this->ids['orange']}", [
            'name' => $product['name'], 'type' => 'standard', 'unit_id' => $this->tenant['unit']->id,
            'category_id' => $this->ids['beverages'], 'brand_id' => $this->ids['acme'],
            'variants' => [['id' => $product['variants'][0]['id'], 'sku' => 'ORANGE-1', 'purchase_price' => '1.00', 'selling_price' => '85.50']],
        ])->assertOk();
        $this->asVisitor();

        // Brief check 10: listing, product page (and quick view), suggestions and the homepage.
        $this->assertSame('85.50', collect($this->list()['data'])->firstWhere('slug', 'orange-juice')['price']);
        $this->getJson('http://berry.test/api/v1/store/products/orange-juice')->assertJsonPath('data.price', '85.50')->assertJsonPath('data.variants.0.price', '85.50');
        $this->getJson('http://berry.test/api/v1/store/search/suggest?q=orange')->assertJsonPath('data.products.0.price', '85.50');
        $this->getJson('http://berry.test/api/v1/store/homepage')->assertJsonPath('data.sections.0.products.0.price', '85.50');
        $this->assertSame('85.50', $this->list('slugs=orange-juice')['data'][0]['price']);
    }

    public function test_a_price_above_the_compare_at_price_ends_the_sale(): void
    {
        $this->fixture();
        $this->actingAsUser($this->tenant['admin']);
        $this->putJson("/api/v1/products/{$this->ids['mango']}", [
            'name' => 'Mango Juice', 'type' => 'standard', 'unit_id' => $this->tenant['unit']->id,
            'category_id' => $this->ids['beverages'], 'brand_id' => $this->ids['pran'],
            'variants' => [['id' => $this->ids['mango_variant'], 'sku' => 'MANGO-1', 'purchase_price' => '1.00', 'selling_price' => '150.00']],
        ])->assertOk();
        $this->asVisitor();

        $card = $this->list('slugs=mango-juice')['data'][0];
        $this->assertSame(['150.00', null, false, null], [$card['price'], $card['compare_at_price'], $card['on_sale'], $card['discount_percent']]);
    }
}
