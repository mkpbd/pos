<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\OnlineCatalog\Application\Contracts\ProductRatings;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Application\Contracts\StorefrontContentVersion;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * E12 SEO: JSON-LD per page type, product/category/brand meta, canonical and noindex rules,
 * the allow_indexing switch, robots.txt and the XML sitemaps.
 */
class StorefrontSeoTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private string $shell;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        $this->shell = (string) tempnam(sys_get_temp_dir(), 'shell');
        file_put_contents($this->shell, '<!doctype html><html><head><title>Storefront</title></head><body><div id="root"></div></body></html>');
        config(['storefront.shell_path' => $this->shell, 'app.url' => 'https://admin.example.test']);
    }

    protected function tearDown(): void
    {
        @unlink($this->shell);
        parent::tearDown();
    }

    /**
     * Berry Kids on berry.test: Clothes › Shirts (listed), brand Polo (listed), a two-variant
     * shirt with an image, low stock on M and none on L, and a single-variant cap.
     *
     * @return array{0: array<string, mixed>, 1: array<string, mixed>}
     */
    private function shop(): array
    {
        $t = $this->openStore('Berry Kids', 'berry.test');
        $org = $t['organization'];
        $clothes = $this->category($org, 'Clothes');
        $shirts = $this->category($org, 'Shirts', $clothes);
        $polo = $this->brand($org, 'Polo');
        $this->listCategory($clothes, ['description_html' => '<p>Everything to <strong>wear</strong>.</p>']);
        $this->listCategory($shirts);
        $this->listBrand($polo, ['description' => 'Classic polo shirts since 1990.']);

        $shirt = $this->makeProduct($t['unit']->id, 'Polo </script> Shirt', [['SHIRT-M', '500.00', ['Size' => 'M']], ['SHIRT-L', '650.00', ['Size' => 'L']]], [
            'category_id' => $shirts, 'brand_id' => $polo, 'options' => [['name' => 'Size', 'values' => ['M', 'L']]],
        ]);
        $this->postJson("/api/v1/products/{$shirt['id']}/images", ['image' => UploadedFile::fake()->image('shirt.jpg', 400, 400)])->assertCreated();
        $this->publish($shirt['id'], ['slug' => 'polo-shirt', 'description_html' => '<p>Soft &amp; breathable cotton.</p><p>Machine washable.</p>']);
        $cap = $this->makeProduct($t['unit']->id, 'Cap', [['CAP', '120.00']], ['brand_id' => $polo]);
        $this->publish($cap['id'], ['slug' => 'cap', 'seo_title' => 'Best cap', 'seo_description' => 'A cap for sunny days']);

        $variants = array_column($shirt['variants'], 'id', 'sku');
        $this->stockUp($t, [$variants['SHIRT-M'] => '3', $cap['variants'][0]['id'] => '50']);

        return [$t, compact('clothes', 'shirts', 'polo', 'shirt', 'cap')];
    }

    /**
     * JSON-LD documents of a page keyed by @type (each must be valid JSON).
     *
     * @return array<string, array<string, mixed>>
     */
    private function jsonLd(string $html): array
    {
        preg_match_all('#<script type="application/ld\+json">(.*?)</script>#s', $html, $m);
        $docs = [];
        foreach ($m[1] as $json) {
            $doc = json_decode($json, true, flags: JSON_THROW_ON_ERROR);
            $this->assertSame('https://schema.org', $doc['@context']);
            $docs[$doc['@type']] = $doc;
        }

        return $docs;
    }

    public function test_product_page_has_product_and_breadcrumb_structured_data_and_meta(): void
    {
        [$t, $ids] = $this->shop();
        $this->postJson('/api/v1/promotions', [
            'name' => 'Shirt week', 'type' => 'percent', 'value' => '10', 'scope' => 'products', 'target_ids' => [$ids['shirt']['id']],
            'trigger' => 'automatic', 'ends_at' => now()->addDays(5)->toIso8601String(),
        ])->assertCreated();
        $this->asVisitor();

        $html = $this->get('http://berry.test/product/polo-shirt')->assertOk()->assertHeader('X-Robots-Tag', 'all')->getContent();
        // The product name cannot end a <script> element early.
        $this->assertSame(4, substr_count($html, '</script>'), 'Organization, Product, BreadcrumbList and the bootstrap payload');
        $this->assertStringContainsString('<title>Polo &lt;/script&gt; Shirt | Berry Kids</title>', $html);
        $this->assertStringContainsString('<meta name="description" content="Soft &amp; breathable cotton. Machine washable.">', $html);
        $this->assertStringContainsString('<meta property="og:type" content="product">', $html);
        $this->assertMatchesRegularExpression('#<meta property="og:image" content="http://berry\.test/storage/[^"]+">#', $html);
        $this->assertStringContainsString('<link rel="canonical" href="http://berry.test/product/polo-shirt">', $html);

        $ld = $this->jsonLd($html);
        $this->assertSame(['Organization', 'Product', 'BreadcrumbList'], array_keys($ld));
        $product = $ld['Product'];
        $this->assertSame('Polo </script> Shirt', $product['name']);
        $this->assertSame('Soft & breathable cotton. Machine washable.', $product['description']);
        $this->assertSame('http://berry.test/product/polo-shirt', $product['url']);
        $this->assertSame(['@type' => 'Brand', 'name' => 'Polo'], $product['brand']);
        $this->assertStringStartsWith('http://berry.test/storage/', $product['image'][0]);
        $this->assertArrayNotHasKey('sku', $product, 'Several variants: the SKUs are on the offers.');
        $this->assertArrayNotHasKey('aggregateRating', $product, 'No approved review yet.');

        $offers = $product['offers'];
        $this->assertSame(['AggregateOffer', '450.00', '585.00', 2, 'BDT'], [$offers['@type'], $offers['lowPrice'], $offers['highPrice'], $offers['offerCount'], $offers['priceCurrency']]);
        $bySku = array_column($offers['offers'], null, 'sku');
        $this->assertSame('450.00', $bySku['SHIRT-M']['price'], 'The promotional price.');
        $this->assertSame(now()->addDays(5)->utc()->toDateString(), substr($bySku['SHIRT-M']['priceValidUntil'], 0, 10));
        $this->assertSame('https://schema.org/LimitedAvailability', $bySku['SHIRT-M']['availability']);
        $this->assertSame('https://schema.org/OutOfStock', $bySku['SHIRT-L']['availability']);

        $this->assertSame(
            [['Home', 'http://berry.test/'], ['Clothes', 'http://berry.test/category/clothes'], ['Shirts', 'http://berry.test/category/shirts'], ['Polo </script> Shirt', 'http://berry.test/product/polo-shirt']],
            array_map(fn (array $i) => [$i['name'], $i['item']], $ld['BreadcrumbList']['itemListElement']),
        );
        $this->assertSame([1, 2, 3, 4], array_column($ld['BreadcrumbList']['itemListElement'], 'position'));

        // One variant: a single Offer with the SKU; SEO title and description win.
        $cap = $this->get('http://berry.test/product/cap')->assertOk()->getContent();
        $this->assertStringContainsString('<title>Best cap | Berry Kids</title>', $cap);
        $this->assertStringContainsString('<meta name="description" content="A cap for sunny days">', $cap);
        $capLd = $this->jsonLd($cap)['Product'];
        $this->assertSame('CAP', $capLd['sku']);
        $this->assertSame(['Offer', '120.00', 'BDT', 'https://schema.org/InStock'], [$capLd['offers']['@type'], $capLd['offers']['price'], $capLd['offers']['priceCurrency'], $capLd['offers']['availability']]);
        $this->assertArrayNotHasKey('priceValidUntil', $capLd['offers']);
    }

    public function test_product_rating_is_present_only_with_approved_reviews(): void
    {
        $this->shop();
        $this->app->instance(ProductRatings::class, new class implements ProductRatings
        {
            public function summary(string $productId): ?array
            {
                return ['average' => '4.5', 'count' => 2];
            }

            public function summaries(array $productIds): array
            {
                return array_fill_keys($productIds, ['average' => '4.5', 'count' => 2]);
            }
        });
        $this->asVisitor();

        $product = $this->jsonLd($this->get('http://berry.test/product/cap')->getContent())['Product'];
        $this->assertSame(['@type' => 'AggregateRating', 'ratingValue' => '4.5', 'reviewCount' => 2, 'bestRating' => 5, 'worstRating' => 1], $product['aggregateRating']);
    }

    public function test_listing_meta_canonical_and_noindex_for_filtered_listings(): void
    {
        $this->shop();
        $this->asVisitor();

        $html = $this->get('http://berry.test/category/clothes')->assertOk()->assertHeader('X-Robots-Tag', 'all')->getContent();
        $this->assertStringContainsString('<title>Clothes | Berry Kids</title>', $html);
        $this->assertStringContainsString('<meta name="description" content="Everything to wear.">', $html);
        $this->assertStringNotContainsString('name="robots"', $html);
        $ld = $this->jsonLd($html);
        $this->assertSame(['Organization', 'CollectionPage', 'BreadcrumbList'], array_keys($ld));
        $this->assertSame(['Clothes', 'Everything to wear.', 'http://berry.test/category/clothes'], [$ld['CollectionPage']['name'], $ld['CollectionPage']['description'], $ld['CollectionPage']['url']]);
        $this->assertSame(['Home', 'Clothes'], array_column($ld['BreadcrumbList']['itemListElement'], 'name'));

        $brand = $this->get('http://berry.test/brand/polo')->assertOk()->getContent();
        $this->assertStringContainsString('<meta name="description" content="Classic polo shirts since 1990.">', $brand);
        $this->assertSame(['Home', 'Polo'], array_column($this->jsonLd($brand)['BreadcrumbList']['itemListElement'], 'name'));

        // Page 2 keeps its page in the canonical URL and stays indexable; tracking parameters are no filter.
        $page2 = $this->get('http://berry.test/category/clothes?page=2&utm_source=mail')->assertOk()->assertHeader('X-Robots-Tag', 'all')->getContent();
        $this->assertStringContainsString('<link rel="canonical" href="http://berry.test/category/clothes?page=2">', $page2);

        // Filters and sorting: noindex,follow, canonical to the plain listing, only Organization data.
        foreach (['/category/clothes?sort=price_asc', '/brand/polo?in_stock=1', '/shop?brand=polo&page=3', '/category/clothes?attr.size=M'] as $url) {
            $filtered = $this->get('http://berry.test'.$url)->assertOk()->assertHeader('X-Robots-Tag', 'noindex')->getContent();
            $this->assertStringContainsString('<meta name="robots" content="noindex, follow">', $filtered, $url);
            $this->assertStringContainsString('<link rel="canonical" href="http://berry.test'.strtok($url, '?').(str_contains($url, 'page=3') ? '?page=3' : '').'">', $filtered, $url);
            $this->assertSame(['Organization'], array_keys($this->jsonLd($filtered)), $url);
        }
        // Product pages ignore query strings in the canonical URL.
        $this->assertStringContainsString('<link rel="canonical" href="http://berry.test/product/cap">', $this->get('http://berry.test/product/cap?ref=x')->getContent());
    }

    public function test_homepage_organization_and_website_and_no_rich_data_on_noindex_pages(): void
    {
        ['admin' => $admin] = $this->openStore('Berry Kids', 'berry.test');
        $this->putJson('/api/v1/storefront/theme', ['footer' => ['contact' => ['phone' => '+8801712345678', 'email' => 'hello@berry.test']]])->assertOk();
        $this->asVisitor();

        $ld = $this->jsonLd($this->get('http://berry.test/')->assertOk()->getContent());
        $this->assertSame(['Organization', 'WebSite'], array_keys($ld));
        $this->assertSame(['Berry Kids', 'http://berry.test/'], [$ld['Organization']['name'], $ld['Organization']['url']]);
        $this->assertSame(['@type' => 'ContactPoint', 'contactType' => 'customer service', 'telephone' => '+8801712345678', 'email' => 'hello@berry.test'], $ld['Organization']['contactPoint']);
        $this->assertSame('http://berry.test/search?q={search_term_string}', $ld['WebSite']['potentialAction']['target']['urlTemplate']);
        $this->assertSame('required name=search_term_string', $ld['WebSite']['potentialAction']['query-input']);

        // Not on other pages, and noindex pages carry only the Organization.
        $this->assertSame(['Organization'], array_keys($this->jsonLd($this->get('http://berry.test/shop')->getContent())));
        $this->assertSame(['Organization'], array_keys($this->jsonLd($this->get('http://berry.test/cart')->getContent())));
        $this->assertSame(['Organization'], array_keys($this->jsonLd($this->get('http://berry.test/nope')->assertNotFound()->getContent())));

        // A closed store's staff preview: noindex, Organization only.
        $this->actingAsUser($admin);
        $this->patchJson('/api/v1/storefront/settings', ['is_enabled' => false])->assertOk();
        $preview = $this->get('http://berry.test/')->assertOk()->assertHeader('X-Robots-Tag', 'noindex')->getContent();
        $this->assertStringContainsString('<meta name="robots" content="noindex, follow">', $preview);
        $this->assertSame(['Organization'], array_keys($this->jsonLd($preview)));
    }

    public function test_blog_post_and_content_page_structured_data(): void
    {
        ['admin' => $admin] = $this->openStore('Berry Kids', 'berry.test');
        $category = $this->postJson('/api/v1/cms/blog-categories', ['name' => 'Recipes'])->assertCreated()->json('data');
        $this->postJson('/api/v1/cms/blog-posts', [
            'slug' => 'dal-soup', 'title' => 'Dal soup', 'status' => 'published', 'category_id' => $category['id'],
            'excerpt' => 'A warm bowl', 'body_html' => '<p>Cook it.</p>',
        ])->assertCreated();
        $this->postJson('/api/v1/cms/pages', ['slug' => 'about', 'title' => 'About us', 'status' => 'published', 'body_html' => '<p>Hi</p>'])->assertCreated();
        $this->asVisitor();

        $ld = $this->jsonLd($this->get('http://berry.test/blog/dal-soup')->assertOk()->getContent());
        $this->assertSame(['Organization', 'BlogPosting', 'BreadcrumbList'], array_keys($ld));
        $post = $ld['BlogPosting'];
        $this->assertSame(['Dal soup', 'A warm bowl'], [$post['headline'], $post['description']]);
        $this->assertSame(['@type' => 'WebPage', '@id' => 'http://berry.test/blog/dal-soup'], $post['mainEntityOfPage']);
        $this->assertSame('Person', $post['author']['@type']);
        $this->assertSame(explode(' ', $admin->name)[0], $post['author']['name']);
        $this->assertSame(['Organization', 'Berry Kids'], [$post['publisher']['@type'], $post['publisher']['name']]);
        $this->assertNotEmpty($post['datePublished']);
        $this->assertNotEmpty($post['dateModified']);
        $this->assertSame(['Home', 'Blog', 'Recipes', 'Dal soup'], array_column($ld['BreadcrumbList']['itemListElement'], 'name'));

        $page = $this->jsonLd($this->get('http://berry.test/pages/about')->assertOk()->getContent());
        $this->assertSame(['Organization', 'BreadcrumbList'], array_keys($page));
        $this->assertSame([['Home', 'http://berry.test/'], ['About us', 'http://berry.test/pages/about']], array_map(fn (array $i) => [$i['name'], $i['item']], $page['BreadcrumbList']['itemListElement']));

        // Blog category pages: "{name} | {store}" like the SPA.
        $this->assertStringContainsString('<title>Recipes | Berry Kids</title>', $this->get('http://berry.test/blog/category/recipes')->getContent());
    }

    public function test_allow_indexing_setting_noindexes_the_store_and_closes_robots(): void
    {
        ['admin' => $admin] = $this->openStore('Berry Kids', 'berry.test');
        $this->getJson('/api/v1/storefront/settings')->assertOk()->assertJsonPath('data.allow_indexing', true);
        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertJsonPath('data.store.allow_indexing', true);

        $this->actingAsUser($admin);
        $this->patchJson('/api/v1/storefront/settings', ['allow_indexing' => false])->assertOk()->assertJsonPath('data.allow_indexing', false);
        $this->patchJson('/api/v1/storefront/settings', ['allow_indexing' => 'maybe'])->assertUnprocessable();
        $this->asVisitor();

        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertJsonPath('data.store.allow_indexing', false);
        $html = $this->get('http://berry.test/')->assertOk()->assertHeader('X-Robots-Tag', 'noindex')->getContent();
        $this->assertStringContainsString('<meta name="robots" content="noindex, follow">', $html);
        $this->assertSame(['Organization'], array_keys($this->jsonLd($html)));
        $this->assertSame("User-agent: *\nDisallow: /\n", $this->get('http://berry.test/robots.txt')->assertOk()->getContent());
        $this->get('http://berry.test/sitemap.xml')->assertNotFound();
    }

    public function test_robots_txt_variants(): void
    {
        ['admin' => $admin] = $this->openStore('Berry Kids', 'berry.test');
        $this->postJson('/api/v1/storefront/domains', ['host' => 'www.berry.test'])->assertCreated();
        $this->asVisitor();

        $robots = $this->get('http://berry.test/robots.txt')->assertOk()->assertHeader('Content-Type', 'text/plain; charset=UTF-8');
        $this->assertSame(implode("\n", [
            'User-agent: *', 'Disallow: /cart', 'Disallow: /checkout', 'Disallow: /account', 'Disallow: /order/', 'Disallow: /search',
            'Disallow: /admin', 'Disallow: /api/', '', 'Sitemap: https://berry.test/sitemap.xml',
        ])."\n", $robots->getContent());
        $this->assertNull($robots->headers->getCookies()[0] ?? null, 'robots.txt sets no cookie');

        // A secondary domain and unknown hosts: everything disallowed.
        $this->assertSame("User-agent: *\nDisallow: /\n", $this->get('http://www.berry.test/robots.txt')->getContent());
        $this->assertSame("User-agent: *\nDisallow: /\n", $this->get('http://unknown.test/robots.txt')->assertOk()->getContent());

        // A closed store.
        $this->actingAsUser($admin);
        $this->patchJson('/api/v1/storefront/settings', ['is_enabled' => false])->assertOk();
        $this->asVisitor();
        $this->assertSame("User-agent: *\nDisallow: /\n", $this->get('http://berry.test/robots.txt')->getContent());
    }

    public function test_sitemaps_list_only_live_records_on_the_primary_domain(): void
    {
        [$t, $ids] = $this->shop();
        $draft = $this->makeProduct($t['unit']->id, 'Draft', [['DRAFT', '10.00']]);
        $this->publish($draft['id'], ['slug' => 'draft-thing', 'is_published' => false]);
        $later = $this->makeProduct($t['unit']->id, 'Later', [['LATER', '10.00']]);
        $this->publish($later['id'], ['slug' => 'later-thing', 'published_at' => now()->addDay()->toIso8601String()]);
        $this->postJson('/api/v1/cms/pages', ['slug' => 'about', 'title' => 'About us', 'status' => 'published'])->assertCreated();
        $this->postJson('/api/v1/cms/pages', ['slug' => 'secret', 'title' => 'Secret', 'status' => 'draft'])->assertCreated();
        $recipes = $this->postJson('/api/v1/cms/blog-categories', ['name' => 'Recipes'])->assertCreated()->json('data.id');
        $this->postJson('/api/v1/cms/blog-categories', ['name' => 'Empty news'])->assertCreated();
        $this->postJson('/api/v1/cms/blog-posts', ['slug' => 'dal-soup', 'title' => 'Dal soup', 'status' => 'published', 'category_id' => $recipes])->assertCreated();
        $this->postJson('/api/v1/cms/blog-posts', ['slug' => 'draft-post', 'title' => 'Draft', 'status' => 'draft'])->assertCreated();

        // Another organization's catalog never shows up.
        $other = $this->openStore('Tiny Toes', 'tiny.test');
        $foreign = $this->makeProduct($other['unit']->id, 'Foreign', [['FOREIGN', '10.00']]);
        $this->publish($foreign['id'], ['slug' => 'foreign-thing']);
        $this->asVisitor();

        $index = $this->get('http://berry.test/sitemap.xml')->assertOk()->assertHeader('Content-Type', 'application/xml; charset=UTF-8');
        $xml = simplexml_load_string($index->getContent());
        $this->assertSame('sitemapindex', $xml->getName());
        $locs = array_map('strval', $xml->xpath('//*[local-name()="loc"]'));
        $this->assertSame(array_map(fn (string $n) => "https://berry.test/sitemaps/{$n}.xml", ['pages', 'products-1', 'categories', 'brands', 'blog']), $locs);

        $products = $this->get('http://berry.test/sitemaps/products-1.xml')->assertOk()->getContent();
        $this->assertStringContainsString('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"', $products);
        $urls = simplexml_load_string($products);
        $this->assertSame(['https://berry.test/product/cap', 'https://berry.test/product/polo-shirt'], array_map('strval', $urls->xpath('//*[local-name()="url"]/*[local-name()="loc"]')));
        $this->assertMatchesRegularExpression('#<loc>https://berry\.test/product/polo-shirt</loc><lastmod>\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00</lastmod><image:image><image:loc>https://berry\.test/storage/[^<]+</image:loc></image:image>#', $products);
        $this->assertStringNotContainsString('draft-thing', $products);
        $this->assertStringNotContainsString('later-thing', $products);
        $this->assertStringNotContainsString('foreign', $products);

        $pages = $this->get('http://berry.test/sitemaps/pages.xml')->assertOk()->getContent();
        foreach (['https://berry.test/', 'https://berry.test/shop', 'https://berry.test/blog', 'https://berry.test/pages/about'] as $loc) {
            $this->assertStringContainsString("<loc>{$loc}</loc>", $pages);
        }
        $this->assertStringNotContainsString('secret', $pages);
        $this->assertStringContainsString('<loc>https://berry.test/category/clothes</loc>', $this->get('http://berry.test/sitemaps/categories.xml')->getContent());
        $this->assertStringContainsString('<loc>https://berry.test/brand/polo</loc>', $this->get('http://berry.test/sitemaps/brands.xml')->getContent());
        $blog = $this->get('http://berry.test/sitemaps/blog.xml')->assertOk()->getContent();
        $this->assertStringContainsString('<loc>https://berry.test/blog/dal-soup</loc>', $blog);
        $this->assertStringNotContainsString('draft-post', $blog);
        $this->assertStringContainsString('<loc>https://berry.test/blog/category/recipes</loc>', $blog);
        $this->assertStringNotContainsString('empty-news', $blog);

        $this->get('http://berry.test/sitemaps/products-2.xml')->assertNotFound();
        $this->get('http://berry.test/sitemaps/nope.xml')->assertNotFound();
        $this->assertStringNotContainsString('berry', $this->get('http://tiny.test/sitemaps/products-1.xml')->assertOk()->getContent());

        // Product files hold at most the configured number of URLs.
        config(['storefront.sitemap_products_per_file' => 1]);
        $this->actingAsUser($t['admin']);
        $this->publish($ids['cap']['id'], ['slug' => 'cap', 'is_featured' => true]); // bumps the content version
        $this->asVisitor();
        $this->assertStringContainsString('<loc>https://berry.test/sitemaps/products-2.xml</loc>', $this->get('http://berry.test/sitemap.xml')->getContent());
        $this->assertSame(1, substr_count($this->get('http://berry.test/sitemaps/products-2.xml')->assertOk()->getContent(), '<url>'));
    }

    public function test_sitemaps_are_404_for_closed_stores_and_secondary_domains(): void
    {
        ['admin' => $admin] = $this->openStore('Berry Kids', 'berry.test');
        $this->postJson('/api/v1/storefront/domains', ['host' => 'www.berry.test'])->assertCreated();
        $this->asVisitor();

        $this->get('http://berry.test/sitemap.xml')->assertOk();
        $this->get('http://www.berry.test/sitemap.xml')->assertNotFound();
        $this->get('http://unknown.test/sitemap.xml')->assertNotFound();

        $this->actingAsUser($admin);
        $this->patchJson('/api/v1/storefront/settings', ['is_enabled' => false])->assertOk();
        $this->asVisitor();
        $this->get('http://berry.test/sitemap.xml')->assertNotFound();
        $this->get('http://berry.test/sitemaps/pages.xml')->assertNotFound();
    }

    public function test_public_reads_carry_etags_and_cache_control(): void
    {
        [$t] = $this->shop();
        $this->asVisitor();

        foreach (['products', 'products/cap', 'categories', 'brands/polo', 'homepage', 'blog'] as $path) {
            $first = $this->getJson("http://berry.test/api/v1/store/{$path}")->assertOk()
                ->assertHeader('Cache-Control', 'max-age=60, public, stale-while-revalidate=300');
            $etag = $first->headers->get('ETag');
            $this->assertStringStartsWith('W/"', (string) $etag, $path);
            $this->getJson("http://berry.test/api/v1/store/{$path}", ['If-None-Match' => $etag])->assertStatus(304);
        }

        // The bootstrap starts the shopper session: private, still conditional.
        $boot = $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()->assertHeader('Cache-Control', 'no-cache, private');
        $this->getJson('http://berry.test/api/v1/store/bootstrap', ['If-None-Match' => $boot->headers->get('ETag')])->assertStatus(304);

        // Staff previews are never stored.
        $this->actingAsUser($this->createUserWithRole($t['organization'], SystemRole::OnlineStoreManager));
        $preview = $this->getJson('http://berry.test/api/v1/store/products/cap?preview=1')->assertOk()->assertHeader('Cache-Control', 'no-store, private');
        $this->assertNull($preview->headers->get('ETag'));
        $this->getJson('http://berry.test/api/v1/store/homepage?preview=1')->assertOk()->assertHeader('Cache-Control', 'no-store, private');
    }

    public function test_cached_reads_survive_a_serializing_cache_store(): void
    {
        // The array store keeps PHP objects as they are; a real store (file, database, redis)
        // serializes, and `cache.serializable_classes` = false refuses objects on the way back.
        $dir = storage_path('framework/testing/cache-'.bin2hex(random_bytes(4)));
        config(['cache.stores.serializing' => ['driver' => 'file', 'path' => $dir], 'cache.default' => 'serializing']);
        app('cache')->forgetDriver('serializing');

        try {
            $this->shop();
            $this->asVisitor();
            foreach ([1, 2] as $round) {
                $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk();
                $this->getJson('http://berry.test/api/v1/store/homepage')->assertOk();
                $this->getJson('http://berry.test/api/v1/store/products')->assertOk()->assertJsonCount(2, 'data');
                $this->get('http://berry.test/sitemap.xml')->assertOk();
                $this->get('http://berry.test/sitemaps/products-1.xml')->assertOk();
            }
        } finally {
            File::deleteDirectory($dir);
        }
    }

    public function test_storefront_reads_are_cached_per_content_version_and_writes_invalidate(): void
    {
        [$t, $ids] = $this->shop();
        $org = $t['organization']->id;
        $version = app(StorefrontContentVersion::class);
        $this->asVisitor();

        $this->getJson('http://berry.test/api/v1/store/products')->assertOk()->assertJsonCount(2, 'data');
        \DB::enableQueryLog();
        $this->getJson('http://berry.test/api/v1/store/products')->assertOk();
        $this->getJson('http://berry.test/api/v1/store/homepage')->assertOk();
        $this->getJson('http://berry.test/api/v1/store/homepage')->assertOk();
        $listingQueries = array_filter(\DB::getQueryLog(), fn (array $q) => str_contains($q['query'], 'product_listings') && str_contains($q['query'], 'join'));
        \DB::flushQueryLog();
        $this->assertCount(0, $listingQueries, 'The candidate set came from the cache.');

        // A listing write bumps the version; the next read sees it.
        $before = $version->current($org);
        $this->actingAsUser($t['admin']);
        $this->publish($ids['cap']['id'], ['slug' => 'cap', 'is_published' => false]);
        $this->assertGreaterThan($before, $after = $version->current($org));
        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/products')->assertOk()->assertJsonCount(1, 'data');

        // Stock at the fulfilment store bumps; a price change bumps; a stock movement elsewhere does not.
        $this->stockUp($t, [$ids['cap']['variants'][0]['id'] => '1']);
        $this->assertGreaterThan($after, $afterStock = $version->current($org));
        $version->stockChanged($org, '00000000-0000-0000-0000-000000000000');
        $this->assertSame($afterStock, $version->current($org));

        // Another organization's version is untouched by these writes.
        $other = $this->openStore('Tiny Toes', 'tiny.test')['organization']->id;
        $otherVersion = $version->current($other);
        $this->actingAsUser($t['admin']);
        $this->putJson('/api/v1/storefront/theme', ['footer' => ['about' => 'Hello']])->assertOk();
        $this->assertSame($otherVersion, $version->current($other));
        $this->assertGreaterThan($afterStock, $version->current($org));

        // A rolled-back write does not bump.
        $current = $version->current($org);
        \DB::transaction(function () use ($version, $org) {
            $version->bump($org);
            \DB::rollBack();
        });
        $this->assertSame($current, $version->current($org));
    }
}
