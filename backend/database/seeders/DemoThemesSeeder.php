<?php

namespace Database\Seeders;

use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Cart\Application\Actions\ShoppingCart;
use App\Modules\Cart\Domain\CartOwner;
use App\Modules\Catalog\Application\Actions\SaveAttribute;
use App\Modules\Catalog\Application\Actions\SaveCategory;
use App\Modules\Catalog\Application\Actions\SaveUnit;
use App\Modules\Cms\Application\Actions\ManageBlogCategories;
use App\Modules\Cms\Application\Actions\ManageFaq;
use App\Modules\Cms\Application\Actions\SaveBlogPost;
use App\Modules\Cms\Application\Actions\SavePage;
use App\Modules\Cms\Infrastructure\Models\BlogCategory;
use App\Modules\Cms\Infrastructure\Models\BlogPost;
use App\Modules\Cms\Infrastructure\Models\CmsPage;
use App\Modules\Cms\Infrastructure\Models\FaqItem;
use App\Modules\CustomerAccounts\Application\Actions\CreateCustomerAccount;
use App\Modules\Customers\Application\Actions\CustomerAddressBook;
use App\Modules\Inventory\Application\Actions\PostStockAdjustment;
use App\Modules\Media\Application\Actions\UploadMedia;
use App\Modules\OnlineCatalog\Application\Actions\SaveCategoryListing;
use App\Modules\OnlineCatalog\Application\Actions\SaveProductListing;
use App\Modules\OnlineCatalog\Infrastructure\Jobs\RefreshProductStats;
use App\Modules\OnlinePayments\Application\Actions\ConfigurePaymentMethod;
use App\Modules\OnlinePayments\Domain\GatewayCode;
use App\Modules\Orders\Application\Actions\OrderWorkflow;
use App\Modules\Orders\Application\Actions\PlaceOrder;
use App\Modules\Orders\Application\Events\OrderPlaced;
use App\Modules\Orders\Application\Services\CheckoutQuoter;
use App\Modules\Organizations\Application\Actions\ProvisionOrganization;
use App\Modules\Organizations\Application\DTOs\ProvisionOrganizationData;
use App\Modules\Payments\Application\Actions\CloseRegisterSession;
use App\Modules\Payments\Application\Actions\OpenRegisterSession;
use App\Modules\Payments\Infrastructure\Models\CashRegister;
use App\Modules\Products\Application\Actions\ManageProductImages;
use App\Modules\Products\Application\Actions\SaveProduct;
use App\Modules\Products\Application\DTOs\ProductData;
use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Promotions\Application\Actions\SavePromotion;
use App\Modules\Promotions\Infrastructure\Models\Promotion;
use App\Modules\Reviews\Application\Actions\CustomerReviews;
use App\Modules\Reviews\Application\Actions\ModerateReview;
use App\Modules\Sales\Application\Actions\CompleteSale;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shipping\Application\Actions\ManageCouriers;
use App\Modules\Shipping\Application\Actions\ManageShippingMethods;
use App\Modules\Shipping\Application\Actions\ManageShippingZones;
use App\Modules\Shipping\Infrastructure\Models\Courier;
use App\Modules\Storefront\Application\Actions\ApplyThemePreset;
use App\Modules\Storefront\Application\Actions\ManageBanners;
use App\Modules\Storefront\Application\Actions\ManageHomepageSections;
use App\Modules\Storefront\Application\Actions\ReplaceMenuItems;
use App\Modules\Storefront\Application\Actions\SaveMenu;
use App\Modules\Storefront\Application\Actions\SaveStorefrontDomain;
use App\Modules\Storefront\Application\Actions\SaveStorefrontSettings;
use App\Modules\Storefront\Application\Actions\SaveTheme;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use App\Modules\Storefront\Infrastructure\Models\Banner;
use App\Modules\Storefront\Infrastructure\Models\HomepageSection;
use App\Modules\Storefront\Infrastructure\Models\Menu;
use App\Modules\Storefront\Infrastructure\Models\StorefrontDomain;
use App\Modules\Users\Application\Actions\SyncPermissionCatalog;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use RuntimeException;

/**
 * T2: four demo online stores (K1 added the fourth), each its own organization with its own host
 * and theme preset (development only; refuses in production). Run after `migrate:fresh --seed`:
 *
 *   php artisan db:seed --class=DemoThemesSeeder
 *
 *   Green Basket    vegan.shop.localhost     owner@greenbasket.test    / password  coupon GREEN10
 *   Mati & Co.      handmade.shop.localhost  owner@mati.test           / password  coupon MATI15
 *   Classic Shop    classic.shop.localhost   owner@classicshop.test    / password  coupon CLASSIC20
 *   Little Sprouts  kids.shop.localhost      owner@littlesprouts.test  / password  coupon SPROUT10
 *
 * Store content lives in database/seeders/demo-themes/<store>.php, photos (with credits in
 * manifest.json) in demo-themes/images/<store>/. Everything is created through the same
 * application actions as the API: organization, catalog, listings, opening stock (stock
 * adjustment), checkout, promotions, content, theme, delivered orders of three shoppers per
 * store whose approved reviews show on the products, and one cash sale at the shop counter
 * (popularity — "best sellers" — counts completed POS sales). P1b: answered shopper questions
 * and "frequently bought together" scores (DemoProductPageSeeder). P2a: a Facebook campaign with
 * a one-product order page, a short link, visits and three attributed orders (DemoLandingSeeder).
 * P2b: Little Sprouts in social sandbox mode — "Demo Page" connected, product feeds on, two
 * published posts and one scheduled (DemoSocialSeeder).
 *
 * Sale prices: the variant's selling price is the catalog's sale price and its compare-at
 * price the regular one (struck through, "−N %", on-sale sources). The flash sale is an
 * automatic countdown promotion on other products, so sale prices stay exactly as listed.
 *
 * Idempotent and additive: a store whose host (or owner e-mail) already exists is skipped;
 * nothing is updated or deleted. Each store is created in one transaction.
 */
class DemoThemesSeeder extends Seeder
{
    public const STORES = ['vegan', 'handmade', 'classic', 'kids'];

    private const PASSWORD = 'password';

    /** @var array<string, mixed> the store's data file */
    private array $data;

    private string $key;

    private string $adminId;

    /** @var array<string, string> media ids by image name (without .jpg) */
    private array $media = [];

    /** @var array<string, string> category ids by slug */
    private array $categories = [];

    /** @var array<string, Product> by slug */
    private array $products = [];

    /** @var array<string, string> banner ids by image name */
    private array $banners = [];

    /** @var array<string, array{source: string, photographer: string, licence: string, alt: string}> */
    private array $manifest = [];

    public function run(SyncPermissionCatalog $syncCatalog): void
    {
        if (app()->isProduction()) {
            throw new RuntimeException('The demo store seeder must not run in production.');
        }

        $syncCatalog();
        $this->manifest = json_decode((string) file_get_contents(self::path('images/manifest.json')), true, flags: JSON_THROW_ON_ERROR);

        foreach (self::STORES as $key) {
            /** @var array<string, mixed> $data */
            $data = require self::path("{$key}.php");

            if (StorefrontDomain::query()->withoutGlobalScopes()->where('host', $data['host'])->exists()) {
                $this->command?->line("  {$data['name']}: {$data['host']} already exists, skipped.");

                continue;
            }
            if (User::query()->withoutGlobalScopes()->where('email', $data['owner']['email'])->exists()) {
                $this->command?->line("  {$data['name']}: {$data['owner']['email']} already exists, skipped.");

                continue;
            }

            $started = microtime(true);
            DB::transaction(fn () => $this->store($key, $data));
            $this->command?->info(sprintf('  %s: http://%s (%s, %.1f s)', $data['name'], $data['host'], $data['owner']['email'], microtime(true) - $started));
        }
    }

    public static function path(string $file): string
    {
        return __DIR__.'/demo-themes/'.$file;
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function store(string $key, array $data): void
    {
        [$this->key, $this->data, $this->media, $this->categories, $this->products, $this->banners] = [$key, $data, [], [], [], []];

        $result = app(ProvisionOrganization::class)(new ProvisionOrganizationData(
            organizationName: $data['name'],
            adminName: $data['owner']['name'],
            adminEmail: $data['owner']['email'],
            adminPassword: self::PASSWORD,
            currency: (string) config('pos.default_currency'),
            timezone: (string) config('pos.default_timezone'),
            branchName: $data['branch'],
        ));
        $this->adminId = $result['admin']->id;
        $result['admin']->forceFill(['email_verified_at' => now()])->save();

        app(TenantContext::class)->runAs($result['organization']->id, function () {
            $this->catalog();
            $this->openingStock();
            // P1a: photos per colour, swatch styles and size guides (Classic Shop, Little Sprouts).
            DemoVariantsSeeder::apply($this->key, $this->data);
            $this->storefront();
            $this->checkout();
            $promotions = $this->promotions();
            $pages = $this->content();
            $this->homepage($promotions['flash_sale']);
            $this->menus($pages);
            $this->theme();
            $this->reviews();
            $this->counterSale();

            // Best sellers and the popularity sort come from the counter sale.
            app()->call([new RefreshProductStats(app(TenantContext::class)->requireOrganization()), 'handle']);
            // P1b: answered shopper questions and "frequently bought together" from the orders and the counter sale.
            DemoProductPageSeeder::apply($this->data, $this->adminId);
            // P2a: a Facebook campaign with an order page, a short link, visits and attributed orders.
            DemoLandingSeeder::apply($this->data);
            // P2b: Little Sprouts gets the sandbox Facebook Page, posts and product feeds.
            if ($this->key === DemoSocialSeeder::STORE) {
                DemoSocialSeeder::apply($this->data, $this->adminId);
            }
        });
    }

    private function catalog(): void
    {
        $unit = app(SaveUnit::class)(null, ['name' => 'Piece', 'code' => 'pcs']);

        $saveCategory = app(SaveCategory::class);
        foreach (array_keys($this->data['categories']) as $i => $slug) {
            $this->categories[$slug] = $saveCategory(null, ['name' => $this->data['categories'][$slug][0], 'sort_order' => $i + 1])->id;
        }
        // Resolved after the categories exist: the listing action reads the category tree once.
        $saveListing = app(SaveCategoryListing::class);
        foreach ($this->data['categories'] as $slug => [, $image, $description]) {
            $saveListing($this->categories[$slug], [
                'is_visible' => true,
                'slug' => $slug,
                'image_media_id' => $image === null ? null : $this->image($image),
                'description_html' => "<p>{$description}</p>",
                'seo_description' => $description,
            ]);
        }

        // Option names become filterable attributes (colours as swatches).
        $options = [];
        foreach ($this->data['products'] as $product) {
            foreach ($product['variants'] ?? [] as $option => $values) {
                $options[$option] = array_unique([...$options[$option] ?? [], ...(array_is_list($values) ? $values : array_keys($values))]);
            }
        }
        foreach ($options as $option => $values) {
            $swatches = $this->data['swatches'][$option] ?? null;
            app(SaveAttribute::class)(null, [
                'name' => $option,
                'display' => $swatches === null ? 'button' : 'swatch',
                'is_filterable' => true,
                'values' => array_map(fn (string $v) => ['value' => $v, 'swatch_hex' => $swatches[$v] ?? null], array_values($values)),
            ]);
        }

        $saveProduct = app(SaveProduct::class);
        $images = app(ManageProductImages::class);
        $saveProductListing = app(SaveProductListing::class);
        $count = count($this->data['products']);
        $index = 0;
        foreach ($this->data['products'] as $slug => $p) {
            $variants = $this->variants($slug, $p);
            $option = array_key_first($p['variants'] ?? []);

            $product = $saveProduct(null, ProductData::fromArray([
                'name' => $p['name'],
                'description' => $p['text'],
                'type' => 'standard',
                'category_id' => $this->categories[$p['category']],
                'unit_id' => $unit->id,
                'is_active' => true,
                'track_stock' => true,
                'options' => $option === null ? null : [['name' => $option, 'values' => array_column($variants, 'value')]],
                'variants' => array_map(fn (array $v) => [
                    'sku' => $v['sku'],
                    'option_values' => $option === null ? [] : [$option => $v['value']],
                    'purchase_price' => bcmul($v['price'], '0.55', 2),
                    'selling_price' => $v['sale'] ?? $v['price'],
                    'reorder_level' => '5',
                ], $variants),
            ]));
            $this->products[$slug] = $product;

            foreach (["{$slug}.jpg", "{$slug}-2.jpg"] as $file) {
                if (is_file(self::path("images/{$this->key}/{$file}"))) {
                    $images->add($product, $this->upload($file));
                }
            }

            $bySku = $product->variants()->get()->keyBy('sku');
            $sentences = preg_split('/(?<=\.)\s+/', $p['text']) ?: [$p['text']];
            $saveProductListing($product->id, [
                'is_published' => true,
                'slug' => $slug,
                // Later products are newer arrivals.
                'published_at' => now()->subDays($count - $index++)->setTime(9, 0),
                'is_featured' => $p['featured'] ?? false,
                'short_description' => $sentences[0],
                'description_html' => '<p>'.e($p['text']).'</p>',
                'seo_description' => mb_substr($sentences[0], 0, 160),
                'variants' => array_map(fn (array $v) => [
                    'variant_id' => $bySku[$v['sku']]->id,
                    'compare_at_price' => $v['sale'] === null ? null : $v['price'],
                ], $variants),
            ]);
        }
    }

    /**
     * The product's variants in data order: value (null for a single variant), SKU, regular
     * price and sale price.
     *
     * @param  array<string, mixed>  $p
     * @return list<array{value: ?string, sku: string, price: string, sale: ?string}>
     */
    private function variants(string $slug, array $p): array
    {
        $sku = fn (?string $value) => strtoupper($this->data['sku'].'-'.$slug.($value === null ? '' : '-'.preg_replace('/[^A-Za-z0-9]+/', '', $value)));
        $money = fn (?string $amount) => $amount === null ? null : bcadd($amount, '0', 2);

        if (empty($p['variants'])) {
            return [['value' => null, 'sku' => $sku(null), 'price' => $money($p['price']), 'sale' => $money($p['sale'] ?? null)]];
        }

        $values = reset($p['variants']);
        $rows = [];
        foreach ($values as $value => $prices) {
            [$value, $price, $sale] = array_is_list($values)
                ? [$prices, $p['price'], $p['sale'] ?? null]
                : [$value, $prices[0], $prices[1]];
            $rows[] = ['value' => (string) $value, 'sku' => $sku((string) $value), 'price' => $money($price), 'sale' => $money($sale)];
        }

        return $rows;
    }

    /**
     * Opening stock of 20–80 per variant (fixed per SKU) through a stock adjustment; the
     * store's out-of-stock product gets none.
     */
    private function openingStock(): void
    {
        $lines = [];
        foreach ($this->products as $slug => $product) {
            if ($slug === $this->data['out_of_stock']) {
                continue;
            }
            foreach ($product->variants()->get() as $variant) {
                /** @var ProductVariant $variant */
                $lines[] = ['variant_id' => $variant->id, 'quantity' => (string) (20 + crc32($variant->sku) % 61), 'unit_cost' => (string) $variant->purchase_price];
            }
        }

        app(PostStockAdjustment::class)(User::query()->findOrFail($this->adminId), [
            'store_id' => $this->mainStoreId(),
            'reason' => 'opening',
            'note' => 'Opening stock for the online shop',
            'lines' => $lines,
        ]);
    }

    private function storefront(): void
    {
        app(SaveStorefrontDomain::class)(new StorefrontDomain, ['host' => $this->data['host']]);
        app(SaveStorefrontSettings::class)([
            'is_enabled' => true,
            'site_name' => $this->data['name'],
            'meta_description' => $this->data['meta_description'],
            'fulfilment_store_id' => $this->mainStoreId(),
            'return_window_days' => 7,
        ]);
    }

    /**
     * Delivery inside Dhaka (60, free over the store's threshold) and outside (courier 120,
     * COD fee 20), cash on delivery and bank transfer, two couriers.
     */
    private function checkout(): void
    {
        $zones = app(ManageShippingZones::class);
        $methods = app(ManageShippingMethods::class);
        $dhaka = $this->dhakaDistrict();
        $others = DB::table('geo_districts')->where('id', '!=', $dhaka)->orderBy('id')->pluck('id')->map(fn ($id) => (int) $id)->all();

        $inside = $zones->create(['name' => 'Inside Dhaka', 'is_active' => true, 'sort_order' => 0, 'district_ids' => [$dhaka]]);
        $methods->create($inside, [
            'name' => 'Home delivery', 'description' => 'Delivered to your door inside Dhaka.',
            'fee' => '60.00', 'free_over' => $this->data['free_delivery_over'], 'cod_allowed' => true, 'cod_fee' => '0.00',
            'eta_min_days' => 1, 'eta_max_days' => 2,
        ]);
        $outside = $zones->create(['name' => 'Outside Dhaka', 'is_active' => true, 'sort_order' => 1, 'district_ids' => $others]);
        $methods->create($outside, [
            'name' => 'Courier delivery', 'description' => 'Nationwide courier.',
            'fee' => '120.00', 'free_over' => null, 'cod_allowed' => true, 'cod_fee' => '20.00',
            'eta_min_days' => 3, 'eta_max_days' => 5,
        ]);

        $couriers = app(ManageCouriers::class);
        $couriers->create(['name' => 'Pathao', 'tracking_url_template' => 'https://merchant.pathao.com/tracking?consignment_id={tracking}', 'sort_order' => 0]);
        $couriers->create(['name' => 'Steadfast', 'sort_order' => 1]);

        $payments = app(ConfigurePaymentMethod::class);
        $payments(GatewayCode::CashOnDelivery, ['is_enabled' => true]);
        $payments(GatewayCode::BankTransfer, [
            'is_enabled' => true,
            'instructions' => "Demo Bank, account 0000000000 ({$this->data['name']}) — demo only. Use your order number as the payment reference.",
            'settings' => ['hold_hours' => 48],
        ]);
    }

    /**
     * @return array{coupon: Promotion, flash_sale: Promotion}
     */
    private function promotions(): array
    {
        $save = app(SavePromotion::class);
        $coupon = $this->data['coupon'];
        $flash = $this->data['flash_sale'];

        return [
            'coupon' => $save(new Promotion, [
                'name' => $coupon['name'],
                'description' => $coupon['description'],
                'type' => 'percent',
                'value' => $coupon['percent'],
                'scope' => 'order',
                'min_subtotal' => $coupon['min'],
                'trigger' => 'coupon',
                'is_active' => true,
                'coupon_code' => $coupon['code'],
            ]),
            'flash_sale' => $save(new Promotion, [
                'name' => $flash['name'],
                'description' => $flash['description'],
                'type' => 'percent',
                'value' => $flash['percent'],
                'scope' => 'products',
                'target_ids' => array_map(fn (string $slug) => $this->products[$slug]->id, $flash['products']),
                'trigger' => 'automatic',
                'ends_at' => now()->addDays($flash['days'])->setTime(23, 59)->toIso8601String(),
                'show_countdown' => true,
                'is_active' => true,
            ]),
        ];
    }

    /**
     * Pages, FAQ, banners and the blog.
     *
     * @return array<string, string> page ids by key
     */
    private function content(): array
    {
        $savePage = app(SavePage::class);
        $pages = [];
        foreach ([
            'about' => ['about-us', null], 'contact' => ['contact', 'contact'], 'faq' => ['faq', 'faq'],
            'privacy' => ['privacy-policy', null], 'terms' => ['terms', null],
        ] as $key => [$slug, $template]) {
            $page = $this->data['pages'][$key];
            $pages[$key] = $savePage->save(new CmsPage, array_filter([
                'slug' => $slug,
                'title' => $page['title'],
                'template' => $template,
                'status' => 'published',
                'body_html' => $page['body'],
            ], fn ($v) => $v !== null))->id;
        }

        $faq = app(ManageFaq::class);
        foreach ($this->data['faq'] as [$group, $question, $answer]) {
            $faq->save(new FaqItem, ['group' => $group, 'question' => $question, 'answer_html' => $answer]);
        }

        $banners = app(ManageBanners::class);
        foreach ($this->data['banners'] as $image => $banner) {
            $this->banners[$image] = $banners->save(new Banner, $banner + ['desktop_media_id' => $this->image($image)])->id;
        }

        [$name, $slug, $description] = $this->data['blog']['category'];
        $category = app(ManageBlogCategories::class)->save(new BlogCategory, ['name' => $name, 'slug' => $slug, 'description' => $description]);
        $posts = app(SaveBlogPost::class);
        foreach ($this->data['blog']['posts'] as [$postSlug, $title, $excerpt, $cover, $daysAgo, $body]) {
            $posts->save(new BlogPost, [
                'category_id' => $category->id,
                'slug' => $postSlug,
                'title' => $title,
                'excerpt' => $excerpt,
                'body_html' => $body,
                'cover_media_id' => $this->image($cover),
                'status' => 'published',
                'published_at' => now()->subDays($daysAgo)->setTime(9, 0)->toIso8601String(),
                'seo_description' => $excerpt,
            ], $this->adminId);
        }

        return $pages;
    }

    private function homepage(Promotion $flashSale): void
    {
        $sections = app(ManageHomepageSections::class);
        foreach ($this->data['sections'] as $section) {
            $type = $section['type'];
            $attributes = ['type' => $type] + array_intersect_key($section, array_flip(['title', 'subtitle']));
            $config = $section['config'] ?? [];

            if (isset($section['banners'])) {
                $attributes['banner_ids'] = array_map(fn (string $image) => $this->banners[$image], $section['banners']);
            }
            if (isset($section['categories'])) {
                $config = ['source' => 'manual', 'limit' => max(4, count($section['categories']))];
                $attributes['item_ids'] = array_map(fn (string $slug) => $this->categories[$slug], $section['categories']);
            }
            $config = match ($type) {
                'features_strip' => ['items' => $this->data['features']],
                'testimonials' => ['items' => $this->data['testimonials']],
                'hot_deals' => $config + ['promotion_id' => $flashSale->id],
                'rich_text' => ['alignment' => 'center', 'body_html' => $this->data['rich_text']['body']],
                // K1: an optional photo beside the sign-up form (`image`: a demo photo name).
                'newsletter' => $config + array_diff_key($this->data['newsletter'], ['image' => true])
                    + (isset($this->data['newsletter']['image']) ? ['image_media_id' => $this->image($this->data['newsletter']['image'])] : []),
                default => $config,
            };
            if ($type === 'rich_text') {
                $attributes['title'] = $this->data['rich_text']['title'];
            }

            $sections->save(new HomepageSection, $attributes + ['config' => $config]);
        }
    }

    /**
     * @param  array<string, string>  $pages
     */
    private function menus(array $pages): void
    {
        $saveMenu = app(SaveMenu::class);
        $replace = app(ReplaceMenuItems::class);

        $main = $saveMenu->save(new Menu, ['name' => 'Main navigation', 'location' => 'main']);
        $items = [];
        foreach ($this->data['categories'] as $slug => [$name]) {
            $items[] = ['type' => 'category', 'label' => $name, 'target_id' => $this->categories[$slug]];
        }
        $replace($main, [
            ...$items,
            ['type' => 'blog', 'label' => 'Blog'],
            ['type' => 'page', 'label' => 'About', 'target_id' => $pages['about']],
        ]);

        $footer = $saveMenu->save(new Menu, ['name' => 'Information', 'location' => 'footer_1']);
        $replace($footer, [
            ['type' => 'page', 'label' => 'About us', 'target_id' => $pages['about']],
            ['type' => 'page', 'label' => 'Contact', 'target_id' => $pages['contact']],
            ['type' => 'page', 'label' => 'FAQ', 'target_id' => $pages['faq']],
            ['type' => 'page', 'label' => 'Privacy policy', 'target_id' => $pages['privacy']],
            ['type' => 'page', 'label' => 'Terms of service', 'target_id' => $pages['terms']],
        ]);
    }

    /**
     * The preset's look, then the store's announcement and footer content.
     */
    private function theme(): void
    {
        app(ApplyThemePreset::class)($this->data['preset']);

        $theme = $this->data['theme'];
        app(SaveTheme::class)->settings(array_replace_recursive(app(StorefrontConfig::class)->theme()->settings, [
            'announcement' => ['enabled' => true, 'link' => null] + $theme['announcement'],
            'footer' => $theme['footer'],
        ]));
    }

    /**
     * Each reviewer gets a verified account with a Dhaka address and one cash-on-delivery order
     * of the products they review (placed, shipped, delivered, paid); the reviews are approved.
     * Order e-mails and staff notifications of the placement are left out.
     */
    private function reviews(): void
    {
        $carts = app(ShoppingCart::class);
        $quoter = app(CheckoutQuoter::class);
        $place = app(PlaceOrder::class);
        $workflow = app(OrderWorkflow::class);
        $reviews = app(CustomerReviews::class);
        $moderate = app(ModerateReview::class);
        $pathao = Courier::query()->where('name', 'Pathao')->valueOrFail('id');
        $dhakaDistrict = $this->dhakaDistrict();
        $dhakaDivision = (int) DB::table('geo_districts')->where('id', $dhakaDistrict)->value('division_id');

        foreach ($this->data['reviewers'] as $n => $reviewer) {
            $account = app(CreateCustomerAccount::class)([
                'name' => $reviewer['name'],
                'email' => $reviewer['email'],
                'phone' => $reviewer['phone'],
                'password' => self::PASSWORD,
            ]);
            $account->forceFill(['email_verified_at' => now()])->save();
            $address = app(CustomerAddressBook::class)->create($account->customer_id, [
                'label' => 'Home',
                'recipient_name' => $reviewer['name'],
                'phone' => $reviewer['phone'],
                'division_id' => $dhakaDivision,
                'district_id' => $dhakaDistrict,
                'area' => $reviewer['area'],
                'address_line' => 'House '.(10 + $n).', Road '.(3 + $n),
                'postcode' => '1205',
            ]);

            $owner = CartOwner::customer($account->customer_id);
            $carts->clear($owner);
            foreach ($reviewer['reviews'] as [$slug]) {
                $carts->add($owner, $this->firstVariantId($slug), '1');
            }
            $input = ['shipping_address_id' => $address['id'], 'payment_method' => 'cod'];
            $preview = $quoter->quote($carts->find($owner), $input, $account->customer_id, autoPickMethod: true)['preview'];
            $order = Event::fakeFor(fn () => $place($owner, ['customer_id' => $account->customer_id, 'account_id' => $account->id], $input + [
                'contact' => ['name' => $reviewer['name'], 'email' => $account->email, 'phone' => $reviewer['phone']],
                'shipping_method_id' => $preview['shipping_method_id'],
                'notes' => null,
                'save_address' => false,
                'expected_total' => $preview['total'],
            ], ['ip' => null, 'user_agent' => 'Demo seeder', 'site_url' => 'http://'.$this->data['host']])['order'], [OrderPlaced::class]);

            $tracking = sprintf('DEMO-%s-%04d', $this->data['sku'], $n + 1);
            $order = $workflow->process($order, $this->adminId);
            $order = $workflow->ship($order->fresh(), $pathao, $tracking, null, $this->adminId);
            $order = $workflow->deliver($order->fresh(), $this->adminId);
            $workflow->recordCodPayment($order->fresh(), $tracking.'-COD', $this->adminId);

            foreach ($reviewer['reviews'] as [$slug, $rating, $title, $body]) {
                $review = $reviews->submit($account->customer_id, [
                    'product_id' => $this->products[$slug]->id,
                    'rating' => $rating,
                    'title' => $title,
                    'body' => $body,
                ]);
                $moderate->approve($review, $this->adminId);
            }
        }
    }

    /**
     * The best sellers (popularity counts completed POS sales): one cash sale at the shop
     * counter on a "Counter" till, whose shift is then closed with the exact cash.
     */
    private function counterSale(): void
    {
        $admin = User::query()->findOrFail($this->adminId);
        $store = Store::query()->where('code', 'MAIN')->firstOrFail();
        $till = CashRegister::query()->create(['branch_id' => $store->branch_id, 'code' => 'T1', 'name' => 'Counter']);
        $session = app(OpenRegisterSession::class)($admin, $till, '0.00');

        $lines = [];
        $total = '0.00';
        foreach ($this->data['best_sellers'] as $slug => $quantity) {
            $variant = ProductVariant::query()->findOrFail($this->firstVariantId($slug));
            $lines[] = ['variant_id' => $variant->id, 'quantity' => (string) $quantity];
            $total = bcadd($total, bcmul((string) $variant->selling_price, (string) $quantity, 2), 2);
        }
        app(CompleteSale::class)($admin, [
            'store_id' => $store->id,
            'lines' => $lines,
            'payments' => [['method' => 'cash', 'amount' => $total]],
        ]);

        app(CloseRegisterSession::class)($admin, $session->fresh(), $total, 'Demo counter sale');
    }

    /**
     * A demo photo in the media library (alt text from the manifest); the same file twice is
     * the same media item.
     */
    private function image(string $name): string
    {
        return $this->media[$name] ??= app(UploadMedia::class)($this->upload("{$name}.jpg"), $this->manifest["{$this->key}/{$name}.jpg"]['alt'] ?? null)['media']->id;
    }

    private function upload(string $file): UploadedFile
    {
        $path = self::path("images/{$this->key}/{$file}");
        if (! is_file($path)) {
            throw new RuntimeException("Demo image missing: {$path}");
        }

        // Stored with storeAs(), which copies the file: the original stays in place.
        return new UploadedFile($path, $file, 'image/jpeg', null, true);
    }

    /**
     * The product's first variant in data order (what a shopper picks by default).
     */
    private function firstVariantId(string $slug): string
    {
        $sku = $this->variants($slug, $this->data['products'][$slug])[0]['sku'];

        return $this->products[$slug]->variants()->where('sku', $sku)->valueOrFail('id');
    }

    private function mainStoreId(): string
    {
        return Store::query()->where('code', 'MAIN')->valueOrFail('id');
    }

    private function dhakaDistrict(): int
    {
        return (int) DB::table('geo_districts')->where('name_en', 'Dhaka')->value('id');
    }
}
