<?php

namespace Database\Seeders;

use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Cart\Application\Actions\Wishlists;
use App\Modules\Catalog\Application\Actions\SaveAttribute;
use App\Modules\Catalog\Infrastructure\Models\Brand;
use App\Modules\Catalog\Infrastructure\Models\Category;
use App\Modules\Catalog\Infrastructure\Models\Unit;
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
use App\Modules\OnlineCatalog\Application\Actions\SaveBrandListing;
use App\Modules\OnlineCatalog\Application\Actions\SaveCategoryListing;
use App\Modules\OnlineCatalog\Application\Actions\SaveProductListing;
use App\Modules\OnlineCatalog\Application\Actions\SaveRelatedProducts;
use App\Modules\OnlineCatalog\Infrastructure\Jobs\RefreshProductStats;
use App\Modules\Products\Application\Actions\ManageProductImages;
use App\Modules\Products\Application\Actions\SaveProduct;
use App\Modules\Products\Application\DTOs\ProductData;
use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Slug;
use App\Modules\Storefront\Application\Actions\ManageBanners;
use App\Modules\Storefront\Application\Actions\ManageHomepageSections;
use App\Modules\Storefront\Application\Actions\ReplaceMenuItems;
use App\Modules\Storefront\Application\Actions\SaveMenu;
use App\Modules\Storefront\Application\Actions\SaveStorefrontDomain;
use App\Modules\Storefront\Application\Actions\SaveStorefrontSettings;
use App\Modules\Storefront\Infrastructure\Models\Banner;
use App\Modules\Storefront\Infrastructure\Models\HomepageSection;
use App\Modules\Storefront\Infrastructure\Models\Menu;
use App\Modules\Storefront\Infrastructure\Models\StorefrontDomain;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * An open demo storefront on the local development host (STOREFRONT_DEFAULT_HOST,
 * default shop.localhost), created through the real use cases: content pages, FAQ,
 * banners (plain generated artwork, no third-party images) and a homepage. Menus only
 * link to pages that exist in this phase.
 *
 * Online catalog (E6): the main store fulfils online orders; every demo product for sale is
 * listed (two featured, two with a compare-at price), categories and brands are visible,
 * a "Size" attribute links the polo shirt's option, products get generated artwork, and the
 * homepage and main menu link into the shop.
 */
class DemoStorefrontSeeder extends Seeder
{
    public function run(
        string $organizationId,
        TenantContext $tenant,
        ?string $adminId,
        SaveStorefrontDomain $saveDomain,
        SaveStorefrontSettings $saveSettings,
        SaveMenu $saveMenu,
        ReplaceMenuItems $replaceItems,
        SavePage $pages,
        ManageFaq $faq,
        UploadMedia $upload,
        ManageBanners $banners,
        ManageHomepageSections $sections,
        ManageBlogCategories $blogCategories,
        SaveBlogPost $blogPosts,
    ): void {
        $host = (string) (config('storefront.default_host') ?: 'shop.localhost');

        $tenant->runAs($organizationId, function () use ($host, $adminId, $saveDomain, $saveSettings, $saveMenu, $replaceItems, $pages, $faq, $upload, $banners, $sections, $blogCategories, $blogPosts) {
            $saveDomain(new StorefrontDomain, ['host' => $host]);
            $saveSettings([
                'is_enabled' => true,
                'site_name' => 'Demo Mart',
                'meta_description' => 'Groceries and household goods from Demo Mart, Dhaka.',
                'fulfilment_store_id' => Store::query()->where('code', 'MAIN')->value('id'),
                // E10b: online returns within 7 days of delivery.
                'return_window_days' => 7,
            ]);
            $catalog = $this->onlineCatalog($adminId, $upload);

            $about = $pages->save(new CmsPage, [
                'slug' => 'about-us',
                'title' => 'About us',
                'status' => 'published',
                'body_html' => '<h2>Your neighbourhood store, online</h2><p>Demo Mart has served Dhanmondi since 2012. Order the groceries and household goods you know from our shelves and we deliver them the same day.</p>',
            ]);
            $faqPage = $pages->save(new CmsPage, [
                'slug' => 'faq',
                'title' => 'Frequently asked questions',
                'template' => 'faq',
                'status' => 'published',
                'body_html' => '<p>Can\'t find your answer? Write to us from the contact page.</p>',
            ]);
            $contact = $pages->save(new CmsPage, [
                'slug' => 'contact',
                'title' => 'Contact us',
                'template' => 'contact',
                'status' => 'published',
                'body_html' => '<p>Questions about an order or a product? Send us a message and we reply within one working day.</p>',
            ]);
            $privacy = $pages->save(new CmsPage, [
                'slug' => 'privacy-policy',
                'title' => 'Privacy policy',
                'status' => 'published',
                'body_html' => '<h2>What we collect</h2><p>Your name, phone number, e-mail and delivery address, only to process your orders.</p><h2>Newsletter</h2><p>We send news only after you confirm your address, and every e-mail has an unsubscribe link.</p>',
            ]);

            foreach ([
                ['Delivery', 'Where do you deliver?', '<p>Everywhere inside Dhaka city.</p>'],
                ['Delivery', 'How fast is delivery?', '<p>Orders placed before 4 pm arrive the same day.</p>'],
                ['Payments', 'Which payment methods do you accept?', '<p>Cash on delivery, cards and mobile banking.</p>'],
                [null, 'Can I return a product?', '<p>Unopened products can be returned within 7 days with the receipt.</p>'],
            ] as [$group, $question, $answer]) {
                $faq->save(new FaqItem, ['group' => $group, 'question' => $question, 'answer_html' => $answer]);
            }

            $image = fn (string $name, array $from, array $to, int $width, int $height) => $upload($this->artwork($name, $from, $to, $width, $height), null)['media']->id;

            $hero1 = $banners->save(new Banner, [
                'placement' => 'hero_slider', 'name' => 'Fresh week', 'kicker' => 'This week',
                'title' => 'Fresh vegetables every morning', 'subtitle' => 'Picked up from Kawran Bazar at dawn, at your door by noon.',
                'button_label' => 'About us', 'link_url' => '/pages/about-us',
                'desktop_media_id' => $image('hero-fresh.jpg', [47, 133, 90], [16, 74, 50], 1600, 600),
                'text_color' => '#ffffff',
            ]);
            $hero2 = $banners->save(new Banner, [
                'placement' => 'hero_slider', 'name' => 'Same-day delivery', 'kicker' => 'Dhaka',
                'title' => 'Same-day delivery', 'subtitle' => 'Order before 4 pm.',
                'button_label' => 'Delivery questions', 'link_url' => '/pages/faq',
                'desktop_media_id' => $image('hero-delivery.jpg', [111, 85, 194], [52, 36, 110], 1600, 600),
                'text_color' => '#ffffff', 'text_position' => 'center',
            ]);
            $tiles = [];
            foreach ([['Household', [194, 65, 12], [120, 35, 5]], ['Snacks', [3, 105, 161], [8, 60, 100]], ['Personal care', [190, 24, 93], [110, 15, 55]]] as $i => [$title, $from, $to]) {
                $tiles[] = $banners->save(new Banner, [
                    'placement' => 'home_promo', 'name' => $title, 'title' => $title, 'subtitle' => 'In store and online',
                    'link_url' => '/pages/about-us',
                    'desktop_media_id' => $image("tile-{$i}.jpg", $from, $to, 800, 600),
                ])->id;
            }

            // E11: the blog (two categories, four published posts with cover artwork, one scheduled
            // for next week) and a popup banner that stays inactive until switched on.
            $this->blog($adminId, $image, $blogCategories, $blogPosts);
            $banners->save(new Banner, [
                'placement' => 'popup', 'name' => 'Free delivery popup',
                'title' => 'Free delivery over ৳3000', 'subtitle' => 'Inside Dhaka, on every order above ৳3000.',
                'button_label' => 'Shop now', 'link_url' => '/shop',
                'desktop_media_id' => $image('popup-delivery.jpg', [194, 65, 12], [124, 45, 18], 800, 600),
                'popup_delay_seconds' => 5, 'popup_frequency' => 'once_per_day',
                // Inactive by default so browsing (and full-stack tests) are not interrupted.
                'is_active' => false,
            ]);

            $sections->save(new HomepageSection, ['type' => 'hero_slider', 'banner_ids' => [$hero1->id, $hero2->id]]);
            // E8b: every running flash sale (DemoPromotionsSeeder adds "Juice week"); hidden while none runs.
            $sections->save(new HomepageSection, ['type' => 'hot_deals', 'title' => 'Hot deals', 'subtitle' => 'Ends soon — grab them while the clock runs',
                'config' => ['promotion_id' => null, 'limit' => 8, 'view_all_url' => '/shop']]);
            $sections->save(new HomepageSection, ['type' => 'features_strip', 'config' => ['items' => [
                ['icon' => 'truck', 'title' => 'Same-day delivery', 'text' => 'Inside Dhaka, order before 4 pm'],
                ['icon' => 'credit-card', 'title' => 'Pay your way', 'text' => 'Cash on delivery, cards, mobile banking'],
                ['icon' => 'rotate-ccw', 'title' => '7-day returns', 'text' => 'Unopened products, with receipt'],
                ['icon' => 'headset', 'title' => 'Real people', 'text' => 'Call us 9 am to 9 pm'],
            ]]]);
            $sections->save(new HomepageSection, ['type' => 'product_carousel', 'title' => 'Featured products', 'subtitle' => 'Hand-picked by our team',
                'config' => ['source' => 'featured', 'limit' => 8, 'view_all_url' => '/shop']]);
            $sections->save(new HomepageSection, ['type' => 'category_strip', 'title' => 'Shop by category', 'config' => ['source' => 'top_level', 'limit' => 8]]);
            $sections->save(new HomepageSection, ['type' => 'product_tabs', 'title' => 'Our products', 'config' => ['limit' => 8, 'tabs' => [
                ['label' => 'New arrivals', 'source' => 'new_arrivals'],
                ['label' => 'Best sellers', 'source' => 'best_sellers'],
                ['label' => 'On sale', 'source' => 'on_sale'],
            ]]]);
            $sections->save(new HomepageSection, ['type' => 'banner_grid', 'title' => 'Shop by aisle', 'config' => ['layout' => '3-col'], 'banner_ids' => $tiles]);
            $sections->save(new HomepageSection, ['type' => 'rich_text', 'title' => 'Welcome to Demo Mart', 'config' => [
                'alignment' => 'center',
                'body_html' => '<p>The same prices as in our store, packed by the people you know. Read <a href="/pages/about-us">our story</a> or check the <a href="/pages/faq">FAQ</a>.</p>',
            ]]);
            $sections->save(new HomepageSection, ['type' => 'testimonials', 'title' => 'What neighbours say', 'config' => ['items' => [
                ['quote' => 'My weekly groceries arrive before lunch. I have not queued at a counter for months.', 'name' => 'Nusrat J.', 'role' => 'Dhanmondi', 'rating' => 5],
                ['quote' => 'Friendly staff and honest prices, online too.', 'name' => 'Arif H.', 'role' => 'Lalmatia', 'rating' => 5],
            ]]]);
            $sections->save(new HomepageSection, ['type' => 'blog_posts', 'title' => 'From our blog', 'subtitle' => 'Recipes and news from Demo Mart',
                'config' => ['category_id' => null, 'limit' => 3, 'view_all_url' => '/blog']]);
            $sections->save(new HomepageSection, ['type' => 'newsletter', 'title' => 'Weekly offers in your inbox', 'config' => ['text' => 'One e-mail a week. Unsubscribe any time.']]);

            $main = $saveMenu->save(new Menu, ['name' => 'Main navigation', 'location' => 'main']);
            $replaceItems($main, [
                ['label' => 'Home', 'url' => '/'],
                ['label' => 'Shop', 'url' => '/shop'],
                ['type' => 'category', 'label' => 'Grocery', 'target_id' => $catalog['grocery'], 'is_mega' => true, 'mega_columns' => 2, 'children' => [
                    ['type' => 'category', 'label' => 'Beverages', 'target_id' => $catalog['beverages']],
                    ['type' => 'category', 'label' => 'Rice & Grains', 'target_id' => $catalog['rice']],
                ]],
                ['type' => 'category', 'label' => 'Apparel', 'target_id' => $catalog['apparel']],
                ['type' => 'blog', 'label' => 'Blog'],
                ['type' => 'page', 'label' => 'About us', 'target_id' => $about->id],
                ['type' => 'page', 'label' => 'FAQ', 'target_id' => $faqPage->id],
                ['type' => 'page', 'label' => 'Contact', 'target_id' => $contact->id],
            ]);

            $footer = $saveMenu->save(new Menu, ['name' => 'Demo Mart', 'location' => 'footer_1']);
            $replaceItems($footer, [
                ['label' => 'Home', 'url' => '/'],
                ['type' => 'page', 'label' => 'About us', 'target_id' => $about->id],
            ]);
            $help = $saveMenu->save(new Menu, ['name' => 'Help', 'location' => 'footer_2']);
            $replaceItems($help, [
                ['type' => 'page', 'label' => 'FAQ', 'target_id' => $faqPage->id],
                ['type' => 'page', 'label' => 'Contact us', 'target_id' => $contact->id],
                ['type' => 'page', 'label' => 'Privacy policy', 'target_id' => $privacy->id],
            ]);

            $this->shopper();
        });
    }

    /**
     * The demo blog (E11): "Recipes" and "Store news", four published posts with generated
     * covers (a week apart) and one post scheduled for next week.
     *
     * @param  callable(string, array{int, int, int}, array{int, int, int}, int, int): string  $image
     */
    private function blog(?string $adminId, callable $image, ManageBlogCategories $categories, SaveBlogPost $posts): void
    {
        $recipes = $categories->save(new BlogCategory, ['name' => 'Recipes', 'slug' => 'recipes', 'description' => 'Simple dishes from the ingredients on our shelves.']);
        $news = $categories->save(new BlogCategory, ['name' => 'Store news', 'slug' => 'store-news', 'description' => 'Opening hours, new products and what is happening at Demo Mart.']);

        $paragraphs = fn (string ...$texts) => implode('', array_map(fn (string $t) => "<p>{$t}</p>", $texts));
        foreach ([
            [$recipes, 'mango-lassi', 'A cool mango lassi in five minutes', 'Ripe mangoes, yogurt and a pinch of cardamom: the drink of the season.', [250, 176, 5], [194, 65, 12], 28,
                '<h2>You need</h2><ul><li>2 ripe mangoes</li><li>2 cups of yogurt</li><li>Sugar and cardamom to taste</li></ul><h2>Method</h2>'.$paragraphs('Peel and chop the mangoes, blend them with the yogurt until smooth and add sugar to taste.', 'Serve cold with a pinch of cardamom on top.')],
            [$news, 'same-day-delivery-now-in-mirpur', 'Same-day delivery now reaches Mirpur', 'Order before 4 pm and we deliver to Mirpur the same day.', [3, 105, 161], [8, 60, 100], 21,
                $paragraphs('Good news for our neighbours in Mirpur: from this week our same-day delivery covers your area too.', 'Order before 4 pm and your groceries arrive the same evening, at the usual delivery fee.')],
            [$recipes, 'weeknight-khichuri', 'Weeknight khichuri', 'Rice, lentils and vegetables in one pot: comfort food for rainy evenings.', [47, 133, 90], [16, 74, 50], 14,
                '<h2>You need</h2><ul><li>1 cup rice</li><li>Half a cup of moong dal</li><li>Onion, ginger, turmeric and seasonal vegetables</li></ul>'.$paragraphs('Roast the dal lightly, wash it with the rice and cook everything with the spices and four cups of water until soft.', 'Finish with a spoon of ghee and serve with fried eggplant.')],
            [$news, 'our-new-opening-hours', 'Our new opening hours', 'From next month the store opens at 8 am every day.', [111, 85, 194], [52, 36, 110], 7,
                $paragraphs('Many of you asked for an earlier start. From next month the store opens at 8 am and closes at 10 pm, seven days a week.', 'Online orders are taken around the clock as before.')],
        ] as [$category, $slug, $title, $excerpt, $from, $to, $daysAgo, $body]) {
            $posts->save(new BlogPost, [
                'category_id' => $category->id,
                'slug' => $slug,
                'title' => $title,
                'excerpt' => $excerpt,
                'body_html' => $body,
                'cover_media_id' => $image("blog-{$slug}.jpg", $from, $to, 1200, 630),
                'status' => 'published',
                'published_at' => now()->subDays($daysAgo)->setTime(9, 0)->toIso8601String(),
                'seo_description' => $excerpt,
            ], $adminId);
        }

        $posts->save(new BlogPost, [
            'category_id' => $recipes->id,
            'slug' => 'pitha-for-winter',
            'title' => 'Three pitha for winter mornings',
            'excerpt' => 'Bhapa, chitoi and patishapta: the classics, step by step.',
            'body_html' => $paragraphs('Coming soon: our favourite winter pitha with rice flour, date molasses and coconut.'),
            'status' => 'published',
            'published_at' => now()->addDays(7)->setTime(9, 0)->toIso8601String(),
        ], $adminId);
    }

    /**
     * Customer accounts (E7): shopper@demo.test / password, verified, with a home address in
     * Dhaka and the mango juice on the wishlist. No cart is seeded.
     */
    private function shopper(): void
    {
        $account = app(CreateCustomerAccount::class)([
            'name' => 'Demo Shopper',
            'email' => 'shopper@demo.test',
            'phone' => '01711000000',
            'password' => 'password',
        ]);
        $account->forceFill(['email_verified_at' => now()])->save();

        $dhakaDivision = (int) DB::table('geo_divisions')->where('name_en', 'Dhaka')->value('id');
        $dhakaDistrict = (int) DB::table('geo_districts')->where('division_id', $dhakaDivision)->where('name_en', 'Dhaka')->value('id');
        app(CustomerAddressBook::class)->create($account->customer_id, [
            'label' => 'Home',
            'recipient_name' => 'Demo Shopper',
            'phone' => '01711000000',
            'division_id' => $dhakaDivision,
            'district_id' => $dhakaDistrict,
            'area' => 'Dhanmondi',
            'address_line' => 'House 12, Road 5',
            'postcode' => '1205',
        ]);

        app(Wishlists::class)->add($account->customer_id, Product::query()->where('name', 'Pran Mango Juice 250ml')->value('id'), null);
    }

    /**
     * Web listings, artwork and stock for the demo catalogue (DemoCatalogSeeder's products plus
     * two more), through the real use cases.
     *
     * @return array{grocery: string, beverages: string, rice: string, apparel: string}
     */
    private function onlineCatalog(?string $adminId, UploadMedia $upload): array
    {
        $category = fn (string $name) => Category::query()->where('name', $name)->firstOrFail();
        $brand = fn (string $name) => Brand::query()->where('name', $name)->firstOrFail();
        [$grocery, $beverages, $rice, $apparel] = [$category('Grocery'), $category('Beverages'), $category('Rice & Grains'), $category('Apparel')];
        [$pran, $mills] = [$brand('Pran'), $brand('Local Mills')];

        app(SaveAttribute::class)(null, ['name' => 'Size', 'display' => 'button', 'is_filterable' => true, 'values' => [
            ['value' => 'S'], ['value' => 'M'], ['value' => 'L'], ['value' => 'XL'],
        ]]);

        // Two more products so the shop has something to filter and compare.
        $saveProduct = app(SaveProduct::class);
        $pcs = Unit::query()->where('code', 'pcs')->firstOrFail();
        $kg = Unit::query()->where('code', 'kg')->firstOrFail();
        $litchi = $saveProduct(null, ProductData::fromArray([
            'name' => 'Pran Litchi Drink 250ml', 'type' => 'standard', 'category_id' => $beverages->id, 'brand_id' => $pran->id,
            'unit_id' => $pcs->id, 'is_active' => true, 'track_stock' => true,
            'variants' => [['sku' => 'PRAN-LITCHI-250', 'purchase_price' => '17.00', 'selling_price' => '22.00']],
        ]));
        $chinigura = $saveProduct(null, ProductData::fromArray([
            'name' => 'Chinigura Aromatic Rice', 'type' => 'standard', 'category_id' => $rice->id, 'brand_id' => $mills->id,
            'unit_id' => $kg->id, 'is_active' => true, 'track_stock' => true,
            'variants' => [['sku' => 'LM-CHINIGURA', 'purchase_price' => '120.00', 'selling_price' => '145.00']],
        ]));
        $admin = $adminId !== null ? User::query()->find($adminId) : null;
        if ($admin !== null) {
            app(PostStockAdjustment::class)($admin, [
                'store_id' => Store::query()->where('code', 'MAIN')->value('id'),
                'reason' => 'opening',
                'note' => 'Opening stock for the online shop',
                'lines' => [
                    ['variant_id' => $litchi->variants()->value('id'), 'quantity' => '4', 'unit_cost' => '17.00'],
                    ['variant_id' => $chinigura->variants()->value('id'), 'quantity' => '40', 'unit_cost' => '120.00'],
                ],
            ]);
        }

        $tile = fn (string $name, array $from, array $to) => $upload($this->artwork($name, $from, $to, 800, 600), null)['media']->id;
        $saveCategory = app(SaveCategoryListing::class);
        $saveCategory($grocery->id, ['is_visible' => true, 'image_media_id' => $tile('cat-grocery.jpg', [47, 133, 90], [16, 74, 50]),
            'description_html' => '<p>Everyday groceries at shelf prices.</p>', 'seo_description' => 'Groceries delivered the same day in Dhaka.']);
        $saveCategory($beverages->id, ['is_visible' => true, 'image_media_id' => $tile('cat-beverages.jpg', [245, 158, 11], [180, 83, 9]),
            'banner_media_id' => $upload($this->artwork('banner-beverages.jpg', [245, 158, 11], [124, 45, 18], 1600, 400), null)['media']->id,
            'description_html' => '<p>Juices and soft drinks, chilled in our store.</p>']);
        $saveCategory($rice->id, ['is_visible' => true, 'image_media_id' => $tile('cat-rice.jpg', [202, 138, 4], [113, 63, 18])]);
        $saveCategory($apparel->id, ['is_visible' => true, 'image_media_id' => $tile('cat-apparel.jpg', [111, 85, 194], [52, 36, 110])]);
        $saveBrand = app(SaveBrandListing::class);
        $saveBrand($pran->id, ['is_visible' => true, 'logo_media_id' => $tile('brand-pran.jpg', [220, 38, 38], [153, 27, 27]), 'description' => 'Juices, drinks and snacks from Bangladesh.']);
        $saveBrand($mills->id, ['is_visible' => true, 'logo_media_id' => $tile('brand-mills.jpg', [120, 113, 108], [68, 64, 60]), 'description' => 'Rice and grains milled locally.']);

        $images = app(ManageProductImages::class);
        $saveListing = app(SaveProductListing::class);
        $listings = [
            'Pran Mango Juice 250ml' => [[[245, 158, 11], [194, 65, 12]], [[250, 204, 21], [234, 88, 12]], [
                'is_featured' => true, 'short_description' => 'Real mango pulp, no added colour.',
                'specifications' => [['label' => 'Volume', 'value' => '250 ml'], ['label' => 'Pack', 'value' => 'Tetra pack']],
                'compare_at' => ['30.00'],
            ]],
            'Pran Litchi Drink 250ml' => [[[244, 114, 182], [190, 24, 93]], null, ['short_description' => 'Sweet litchi drink, best served cold.', 'new' => true]],
            'Miniket Rice' => [[[231, 229, 228], [168, 162, 158]], null, [
                'short_description' => 'Fine miniket rice, sold loose by the kilogram.',
                'specifications' => [['label' => 'Origin', 'value' => 'Kushtia'], ['label' => 'Sold by', 'value' => 'kg']],
            ]],
            'Chinigura Aromatic Rice' => [[[254, 243, 199], [217, 119, 6]], null, ['short_description' => 'Small-grain aromatic rice for polao.', 'new' => true]],
            'Cotton Polo Shirt' => [[[59, 130, 246], [30, 64, 175]], [[96, 165, 250], [29, 78, 216]], [
                'is_featured' => true, 'short_description' => 'Breathable pique cotton in three sizes.',
                'description_html' => '<p>A classic polo in soft, breathable cotton pique. Machine washable.</p>',
                'specifications' => [['label' => 'Material', 'value' => '100% cotton'], ['label' => 'Fit', 'value' => 'Regular']],
                'compare_at' => ['520.00', '520.00', '560.00'],
            ]],
        ];
        $day = 0;
        foreach ($listings as $name => [$colors, $hover, $data]) {
            $product = Product::query()->where('name', $name)->firstOrFail();
            $slug = Slug::fromName($name);
            $images->add($product, $this->artwork("{$slug}.jpg", $colors[0], $colors[1], 800, 800));
            if ($hover !== null) {
                $images->add($product, $this->artwork("{$slug}-2.jpg", $hover[0], $hover[1], 800, 800));
            }
            $variants = $product->variants()->get();
            $saveListing($product->id, [
                'is_published' => true,
                'published_at' => now()->subDays(10 - $day++),
                'is_featured' => $data['is_featured'] ?? false,
                'is_new_until' => ($data['new'] ?? false) ? now()->addDays(30)->toDateString() : null,
                'short_description' => $data['short_description'],
                'description_html' => $data['description_html'] ?? null,
                'specifications' => $data['specifications'] ?? [],
                'variants' => array_map(fn ($variant, $compareAt) => ['variant_id' => $variant->id, 'compare_at_price' => $compareAt],
                    $variants->all(), array_pad($data['compare_at'] ?? [], $variants->count(), null)),
            ]);
        }

        $mango = Product::query()->where('name', 'Pran Mango Juice 250ml')->firstOrFail();
        app(SaveRelatedProducts::class)($mango->id, [
            'related' => [$litchi->id],
            'frequently_bought' => [Product::query()->where('name', 'Miniket Rice')->value('id')],
        ]);

        // Best sellers and the popularity sort come from the demo POS sales.
        app()->call([new RefreshProductStats(app(TenantContext::class)->requireOrganization()), 'handle']);

        return ['grocery' => $grocery->id, 'beverages' => $beverages->id, 'rice' => $rice->id, 'apparel' => $apparel->id];
    }

    /**
     * A plain diagonal gradient with soft circles, generated with GD: demo artwork without
     * licensing questions.
     *
     * @param  array{int, int, int}  $from
     * @param  array{int, int, int}  $to
     */
    private function artwork(string $name, array $from, array $to, int $width, int $height): UploadedFile
    {
        $img = imagecreatetruecolor($width, $height);
        for ($x = 0; $x < $width; $x += 4) {
            $t = $x / $width;
            $color = imagecolorallocate($img, ...array_map(fn (int $a, int $b) => (int) round($a + ($b - $a) * $t), $from, $to));
            imagefilledrectangle($img, $x, 0, $x + 3, $height, $color);
        }
        $soft = imagecolorallocatealpha($img, 255, 255, 255, 110);
        imagefilledellipse($img, (int) ($width * 0.82), (int) ($height * 0.3), (int) ($height * 0.9), (int) ($height * 0.9), $soft);
        imagefilledellipse($img, (int) ($width * 0.68), (int) ($height * 0.85), (int) ($height * 0.5), (int) ($height * 0.5), $soft);

        $path = tempnam(sys_get_temp_dir(), 'demo').'.jpg';
        imagejpeg($img, $path, 85);
        imagedestroy($img);

        return new UploadedFile($path, $name, 'image/jpeg', null, true);
    }
}
