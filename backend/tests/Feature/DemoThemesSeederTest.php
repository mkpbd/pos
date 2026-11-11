<?php

namespace Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\Inventory\Infrastructure\Models\StockLevel;
use App\Modules\Organizations\Application\Actions\ProvisionOrganization;
use App\Modules\Organizations\Application\DTOs\ProvisionOrganizationData;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\DemoCatalogSeeder;
use Database\Seeders\DemoCheckoutSeeder;
use Database\Seeders\DemoPromotionsSeeder;
use Database\Seeders\DemoStockSeeder;
use Database\Seeders\DemoThemesSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/**
 * T2: DemoThemesSeeder builds three complete demo stores in their own organizations, leaves
 * other organizations alone, runs only once per store and never in production; the demo
 * gallery lists them; a demo store takes a real order through the public API.
 */
class DemoThemesSeederTest extends TestCase
{
    use ActsAsShopper, RefreshDatabase;

    /** Tables whose rows belong to one organization, compared before and after seeding. */
    private const TENANT_TABLES = [
        'products', 'product_variants', 'categories', 'stock_movements', 'promotions', 'storefront_domains', 'orders',
        'media', 'customers', 'homepage_sections', 'menus', 'cms_pages', 'banners',
    ];

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        Storage::fake((string) config('media.disk'));
        Notification::fake();
        config(['pos.checkout_rate_limit' => 1000]);
    }

    public function test_it_builds_three_demo_stores_and_leaves_other_organizations_alone(): void
    {
        $demoMart = $this->demoMart();
        $before = $this->tenantCounts($demoMart->id);

        $started = microtime(true);
        $this->seed(DemoThemesSeeder::class);
        $seconds = microtime(true) - $started;
        fwrite(STDERR, sprintf("\n  DemoThemesSeeder: %.1f s\n", $seconds));

        // Isolation: Demo Mart is exactly as it was.
        $this->assertSame($before, $this->tenantCounts($demoMart->id));

        foreach (DemoThemesSeeder::STORES as $key) {
            $data = require DemoThemesSeeder::path("{$key}.php");
            $this->assertStore($key, $data);
        }

        // A second run creates nothing.
        $totals = $this->totals();
        $this->seed(DemoThemesSeeder::class);
        $this->assertSame($totals, $this->totals());

        // The gallery lists the three stores in configured order.
        config(['storefront.demo_gallery' => true]);
        $demos = $this->getJson('http://platform.test/api/v1/demo-stores')->assertOk()->json('data');
        $this->assertSame(['vegan.shop.localhost', 'handmade.shop.localhost', 'classic.shop.localhost'], array_column($demos, 'host'));
        $this->assertSame(['Green Basket', 'Mati & Co.', 'Classic Shop'], array_column($demos, 'name'));
        $this->assertSame(['vegan', 'handmade', 'classic'], array_column($demos, 'preset'));
        $vegan = $demos[0];
        $this->assertSame(['host', 'name', 'preset', 'tagline', 'colors', 'heading_font', 'image_url', 'product_count', 'category_names'], array_keys($vegan));
        $this->assertSame('free delivery over ৳1,500 · 100 % plant-based · order by phone 01700-000000', $vegan['tagline']);
        $this->assertSame(['primary' => '#f6c445', 'accent' => '#2e7d32', 'canvas' => '#fbf8ef'], $vegan['colors']);
        $this->assertSame('baloo', $vegan['heading_font']);
        $this->assertSame(19, $vegan['product_count']);
        $this->assertSame(['Fresh produce', 'Vegan pantry', 'Drinks', 'Natural beauty', 'Fitness & nutrition', 'Eco accessories'], $vegan['category_names']);
        $this->assertStringContainsString('/storage/media/', (string) $vegan['image_url']);
        $this->assertSame('playfair', $demos[1]['heading_font']);
        $this->assertCount(5, $demos[2]['category_names']);

        $this->checkoutOnTheVeganStore();
    }

    public function test_it_refuses_to_run_in_production(): void
    {
        $this->app->detectEnvironment(fn () => 'production');

        try {
            (new DemoThemesSeeder)->setContainer($this->app)->__invoke();
            $this->fail('The seeder ran in production.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('production', $e->getMessage());
        }
        $this->assertSame(0, Organization::query()->count());
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function assertStore(string $key, array $data): void
    {
        $org = Organization::query()->where('name', $data['name'])->firstOrFail();
        $count = fn (string $table, array $where = []) => DB::table($table)->where('organization_id', $org->id)->where($where)->count();

        $variants = 0;
        foreach ($data['products'] as $product) {
            $variants += empty($product['variants']) ? 1 : count(reset($product['variants']));
        }
        $this->assertSame(count($data['products']), $count('products'), $key);
        $this->assertSame($variants, $count('product_variants'), $key);
        $this->assertSame(count($data['products']), $count('product_listings', ['is_published' => true]), $key);
        $this->assertSame(count($data['categories']), $count('categories'), $key);
        $this->assertGreaterThanOrEqual(5, $count('product_listings', ['is_featured' => true]), $key);
        $this->assertSame(1, $count('storefront_domains', ['host' => $data['host']]), $key);

        // Opening stock through the ledger: every variant but the out-of-stock product's.
        $levels = StockLevel::query()->withoutGlobalScopes()->where('organization_id', $org->id)->pluck('quantity', 'variant_id');
        foreach (ProductVariant::query()->withoutGlobalScopes()->where('organization_id', $org->id)->get() as $variant) {
            $out = str_starts_with($variant->sku, strtoupper($data['sku'].'-'.$data['out_of_stock']));
            $quantity = (float) ($levels[$variant->id] ?? 0);
            $out ? $this->assertSame(0.0, $quantity, $variant->sku) : $this->assertGreaterThan(0, $quantity, $variant->sku);
        }
        $this->assertSame(1, $count('stock_adjustments'), $key);

        // Sale prices: selling price = sale price, compare-at = regular price.
        $saleVariants = DB::table('variant_listings')->where('organization_id', $org->id)->whereNotNull('compare_at_price')->count();
        $this->assertGreaterThan(0, $saleVariants, $key);

        $this->assertSame([$data['coupon']['code']], DB::table('coupons')->join('promotions', 'promotions.id', '=', 'coupons.promotion_id')
            ->where('promotions.organization_id', $org->id)->pluck('coupons.code')->all());
        $flash = DB::table('promotions')->where('organization_id', $org->id)->where('show_countdown', true)->where('trigger', 'automatic')->first();
        $this->assertNotNull($flash, $key);
        $this->assertSame(count($data['flash_sale']['products']), DB::table('promotion_targets')->where('promotion_id', $flash->id)->count());

        $this->assertSame(array_column($data['sections'], 'type'), DB::table('homepage_sections')->where('organization_id', $org->id)->orderBy('sort_order')->pluck('type')->all());
        $this->assertSame(['footer_1', 'main'], DB::table('menus')->where('organization_id', $org->id)->orderBy('location')->pluck('location')->all());
        $this->assertSame(5, $count('cms_pages'), $key);
        $this->assertSame(4, $count('faq_items'), $key);
        $this->assertSame(3, $count('blog_posts'), $key);
        $reviews = DB::table('reviews')->where('organization_id', $org->id)->where('status', 'approved')->count();
        $this->assertGreaterThanOrEqual(6, $reviews, $key);
        $this->assertLessThanOrEqual(10, $reviews, $key);

        // The store answers on its host with its name and preset, and shows every section.
        $bootstrap = $this->getJson("http://{$data['host']}/api/v1/store/bootstrap")->assertOk()->json('data');
        $this->assertSame([$data['name'], $data['preset'], false], [$bootstrap['store']['name'], $bootstrap['theme']['preset'], $bootstrap['preview']]);
        $this->assertTrue($bootstrap['theme']['announcement'] !== null);
        $this->assertSame($data['theme']['footer']['contact']['email'], $bootstrap['theme']['footer']['contact']['email']);
        $sections = $this->getJson("http://{$data['host']}/api/v1/store/homepage")->assertOk()->json('data.sections');
        $this->assertSame(array_column($data['sections'], 'type'), array_column($sections, 'type'), "{$key}: a homepage section is empty");
    }

    /**
     * A guest buys the plant protein (sale price 2100) with GREEN10 and cash on delivery.
     */
    private function checkoutOnTheVeganStore(): void
    {
        $host = 'vegan.shop.localhost';
        $org = Organization::query()->where('name', 'Green Basket')->firstOrFail();
        $variant = ProductVariant::query()->withoutGlobalScopes()->where('sku', 'GB-PLANT-PROTEIN-CHOCOLATE')->firstOrFail();
        $stock = fn () => (float) StockLevel::query()->withoutGlobalScopes()->where('variant_id', $variant->id)->sum('quantity');
        $before = $stock();
        $this->assertSame('2100.00', (string) $variant->selling_price);

        $url = fn (string $path) => "http://{$host}/api/v1/store/{$path}";
        $this->browse('POST', $url('cart/items'), ['variant_id' => $variant->id, 'quantity' => 1])->assertOk();
        $this->browse('POST', $url('cart/coupon'), ['code' => 'green10'])->assertOk();

        $dhaka = DB::table('geo_districts')->where('name_en', 'Dhaka')->first();
        $method = DB::table('shipping_methods')->where('organization_id', $org->id)->where('name', 'Home delivery')->value('id');
        $address = [
            'recipient_name' => 'Rina Akter', 'phone' => '01712345678', 'division_id' => (int) $dhaka->division_id, 'district_id' => (int) $dhaka->id,
            'area' => 'Dhanmondi', 'address_line' => 'House 1, Road 2', 'postcode' => '1205',
        ];
        $preview = $this->browse('POST', $url('checkout/preview'), ['address' => $address, 'shipping_method_id' => $method, 'payment_method' => 'cod'])
            ->assertOk()->json('data');
        // 2100 − 10 % = 1890, over 1500: free delivery inside Dhaka.
        $this->assertSame(['2100.00', '210.00', '0.00', '1890.00'], [$preview['subtotal'], $preview['discount_total'], $preview['shipping_total'], $preview['total']]);

        $placed = $this->browse('POST', $url('checkout'), [
            'contact' => ['name' => 'Rina Akter', 'email' => 'rina@example.test', 'phone' => '01712345678'],
            'address' => $address,
            'shipping_method_id' => $method,
            'payment_method' => 'cod',
            'expected_total' => $preview['total'],
        ], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated()->json('data.order');

        $this->assertSame('1890.00', $placed['total']);
        $this->assertSame($org->id, DB::table('orders')->where('number', $placed['number'])->where('organization_id', $org->id)->value('organization_id'));
        $this->assertSame($before - 1, $stock());
    }

    /**
     * "Demo Mart" with catalogue, stock, checkout and promotions (a slice of DatabaseSeeder).
     */
    private function demoMart(): Organization
    {
        $result = app(ProvisionOrganization::class)(new ProvisionOrganizationData(
            organizationName: 'Demo Mart', adminName: 'Demo Owner', adminEmail: 'owner@demo.test', adminPassword: 'password',
            currency: 'BDT', timezone: 'Asia/Dhaka', branchName: 'Dhaka Main',
        ));
        $ids = ['organizationId' => $result['organization']->id];
        $seeder = (new DatabaseSeeder)->setContainer($this->app);
        $seeder->callWith(DemoCatalogSeeder::class, $ids);
        $seeder->callWith(DemoStockSeeder::class, $ids + ['adminId' => $result['admin']->id]);
        $seeder->callWith(DemoCheckoutSeeder::class, $ids);
        $seeder->callWith(DemoPromotionsSeeder::class, $ids);

        return $result['organization'];
    }

    /**
     * @return array<string, int>
     */
    private function tenantCounts(string $organizationId): array
    {
        return array_combine(self::TENANT_TABLES, array_map(fn (string $t) => DB::table($t)->where('organization_id', $organizationId)->count(), self::TENANT_TABLES));
    }

    /**
     * @return array<string, int>
     */
    private function totals(): array
    {
        $tables = ['organizations', 'users', ...self::TENANT_TABLES, 'reviews', 'product_images'];

        return array_combine($tables, array_map(fn (string $t) => DB::table($t)->count(), $tables));
    }
}
