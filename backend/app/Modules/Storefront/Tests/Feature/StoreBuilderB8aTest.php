<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Promotions\Tests\Concerns\BuildsPromotions;
use App\Modules\Reviews\Application\Contracts\ReviewShowcase;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * B8a end to end: comparison tables, bundles and flash sale bars resolved for visitors and
 * drafts (products on sale only, draft states), store hours with the organization's time
 * zone, products-per-category charts, nested translations in the render payload, references
 * owned by the organization, the canvas resolver and the templates that place products.
 * (Review walls and ratings charts with real reviews: StoreBuilderB8aReviewsTest.)
 */
class StoreBuilderB8aTest extends TestCase
{
    use BuildsOnlineCatalog, BuildsPromotions, InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

    private const STORE = 'http://berry.test/api/v1/store';

    /** @var array<string, mixed> */
    private array $t;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        Queue::fake();
        Date::setTestNow('2026-11-12T10:00:00+06:00');
        $this->t = $this->openStore('Berry Kids', 'berry.test');
    }

    private function image(string $name = 'photo.jpg'): string
    {
        return $this->post('/api/v1/media', ['file' => UploadedFile::fake()->image($name, 800, 600)], $this->spaHeaders())->assertSuccessful()->json('data.id');
    }

    private function home(): string
    {
        return $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home', 'from' => 'blank'])->assertCreated()->json('data.id');
    }

    /**
     * @param  list<array<string, mixed>>  $elements
     */
    private function saveDraft(string $id, array $elements): TestResponse
    {
        $revision = $this->getJson(self::DOCS."/{$id}")->assertOk()->json('data.draft_revision');

        return $this->putJson(self::DOCS."/{$id}/draft", ['revision' => $revision, 'content' => ['schema_version' => 1, 'sections' => [[
            'id' => 's_main', 'type' => 'section',
            'columns' => [['id' => 'c_main', 'width' => ['base' => 100], 'elements' => $elements]],
        ]]]]);
    }

    /**
     * @param  array<string, mixed>  $props
     * @param  array<string, mixed>  $extra
     * @return array<string, mixed>
     */
    private function el(string $id, string $type, array $props = [], array $extra = []): array
    {
        return ['id' => $id, 'type' => $type, 'props' => $props] + $extra;
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, array<string, mixed>>
     */
    private function elements(array $payload): array
    {
        $result = [];
        foreach ($payload['sections'] as $section) {
            foreach ($section['columns'] as $column) {
                foreach ($column['elements'] as $element) {
                    $result[$element['id']] = $element;
                }
            }
        }

        return $result;
    }

    private function asVisitorNow(): void
    {
        $this->app['auth']->forgetGuards();
    }

    /**
     * @param  array<string, mixed>  $listing
     * @return array<string, mixed>
     */
    private function product(string $name, string $sku, string $price, array $listing = [], array $attributes = []): array
    {
        $product = $this->makeProduct($this->t['unit']->id, $name, [[$sku, $price]], $attributes);
        $this->publish($product['id'], $listing);

        return $product;
    }

    public function test_comparison_bundle_and_flash_sale_show_products_on_sale_and_drafts_say_why_not(): void
    {
        $org = $this->t['organization'];
        $kettle = $this->product('Basic Kettle', 'KB', '1200.00');
        $smart = $this->product('Smart Kettle', 'KS', '2500.00');
        $hidden = $this->product('Secret Kettle', 'KH', '900.00', ['is_published' => false]);
        $mug = $this->product('Mug', 'MUG', '250.00');
        $tea = $this->product('Tea', 'TEA', '180.00');
        $flash = $this->makePromotion($org, ['name' => 'Kettle flash sale', 'type' => 'percent', 'value' => '10', 'scope' => 'products', 'target_ids' => [$kettle['id'], $smart['id']], 'show_countdown' => true, 'ends_at' => '2026-11-14T10:00:00+06:00', 'usage_limit' => 50]);
        $later = $this->makePromotion($org, ['name' => 'Later sale', 'type' => 'percent', 'value' => '15', 'scope' => 'products', 'target_ids' => [$mug['id']], 'show_countdown' => true, 'starts_at' => '2026-11-20T00:00:00+06:00', 'ends_at' => '2026-11-21T00:00:00+06:00']);

        $home = $this->home();
        $this->saveDraft($home, [
            $this->el('e_compare', 'comparison_table', [
                'columns' => [
                    ['id' => 'c1', 'title' => 'Basic', 'product_id' => $kettle['id']],
                    ['id' => 'c2', 'title' => 'Secret', 'product_id' => $hidden['id']],
                    ['id' => 'c3', 'title' => 'Others', 'product_id' => null],
                ],
                'rows' => [['id' => 'r1', 'label' => 'Warranty', 'cells' => ['c1' => ['kind' => 'text', 'text' => '1 year']]]],
            ], ['translations' => ['bn' => ['rows.r1.cells.c1.text' => '১ বছর', 'columns.c3.title' => 'অন্যরা']]]),
            $this->el('e_bundle', 'bundle', ['items' => [['id' => 'b1', 'product_id' => $mug['id']], ['id' => 'b2', 'product_id' => $hidden['id']], ['id' => 'b3', 'product_id' => $tea['id']]]]),
            $this->el('e_small_bundle', 'bundle', ['items' => [['id' => 'b1', 'product_id' => $mug['id']], ['id' => 'b2', 'product_id' => $hidden['id']]]]),
            $this->el('e_flash', 'flash_sale_bar', ['product_limit' => 2], ['translations' => ['bn' => ['title' => 'ফ্ল্যাশ সেল', 'button.label' => 'কিনুন']]]),
            $this->el('e_later', 'flash_sale_bar', ['promotion_id' => $later->id, 'show_products' => true]),
            $this->el('e_pricing', 'pricing_table', ['plans' => [['id' => 'p1', 'name' => 'Box', 'price' => '499.00', 'features' => [['id' => 'f1', 'text' => 'Delivery', 'included' => true]]]]], ['translations' => ['bn' => ['plans.p1.features.f1.text' => 'ডেলিভারি']]]),
        ])->assertOk();
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();

        $this->asVisitorNow();
        $page = $this->getJson(self::STORE.'/builder/pages/home')->assertOk()->json('data');
        $elements = $this->elements($page);
        // The bundle with one product on sale and the scheduled flash sale are left out.
        $this->assertSame(['e_compare', 'e_bundle', 'e_flash', 'e_pricing'], array_keys($elements));
        // Comparison: the cards of the products on sale; the hidden one's column keeps its title.
        $this->assertSame([$kettle['id']], array_keys($page['data']['e_compare']['products']));
        $this->assertSame('Basic Kettle', $page['data']['e_compare']['products'][$kettle['id']]['name']);
        $this->assertArrayNotHasKey('columns', $page['data']['e_compare']);
        $this->assertSame(['Basic', 'Secret', 'Others'], array_column($elements['e_compare']['props']['columns'], 'title'));
        // Bundle: product pages of the items on sale, and only their items.
        $this->assertSame([$mug['id'], $tea['id']], array_keys($page['data']['e_bundle']['products']));
        $this->assertSame(['b1', 'b3'], array_column($elements['e_bundle']['props']['items'], 'id'));
        $detail = $this->getJson(self::STORE.'/products/'.$page['data']['e_bundle']['products'][$mug['id']]['slug'])->assertOk()->json('data');
        $this->assertSame($detail, $page['data']['e_bundle']['products'][$mug['id']]);
        // Flash sale: the running countdown promotion ending first, its products, the usage limit.
        $this->assertSame(['id' => $flash->id, 'name' => 'Kettle flash sale', 'ends_at' => $flash->ends_at->toIso8601String(), 'state' => 'active'], $page['data']['e_flash']['promotion']);
        $this->assertEqualsCanonicalizing([$kettle['id'], $smart['id']], array_column($page['data']['e_flash']['products'], 'id'));
        $this->assertSame(['used' => 0, 'limit' => 50], $page['data']['e_flash']['claimed']);
        $this->assertEqualsCanonicalizing(['label' => 'Shop the sale', 'url' => '/shop'], $elements['e_flash']['props']['button']);
        $this->assertSame('499.00', $elements['e_pricing']['props']['plans'][0]['price']);

        // Bangla: nested list texts and nested props.
        $bn = $this->elements($this->getJson(self::STORE.'/builder/pages/home?lang=bn')->assertOk()->json('data'));
        $this->assertSame('১ বছর', $bn['e_compare']['props']['rows'][0]['cells']['c1']['text']);
        $this->assertSame(['kind' => 'no', 'text' => ''], $bn['e_compare']['props']['rows'][0]['cells']['c2']);
        $this->assertSame('অন্যরা', $bn['e_compare']['props']['columns'][2]['title']);
        $this->assertSame(['ফ্ল্যাশ সেল', 'কিনুন'], [$bn['e_flash']['props']['title'], $bn['e_flash']['props']['button']['label']]);
        $this->assertSame('ডেলিভারি', $bn['e_pricing']['props']['plans'][0]['features'][0]['text']);

        // The draft keeps everything and says why.
        $this->actingAsUser($this->t['admin']);
        $draft = $this->getJson(self::DOCS."/{$home}/render")->assertOk()->json('data');
        $this->assertSame(['c2' => ['state' => 'unavailable']], $draft['data']['e_compare']['columns']);
        $this->assertSame(['b2' => ['state' => 'unavailable']], $draft['data']['e_bundle']['items']);
        $this->assertArrayNotHasKey('state', $draft['data']['e_bundle']);
        $this->assertSame('unavailable', $draft['data']['e_small_bundle']['state']);
        $this->assertSame(['b1', 'b2', 'b3'], array_column($this->elements($draft)['e_bundle']['props']['items'], 'id'));
        $this->assertSame('scheduled', $draft['data']['e_later']['state']);
        $this->assertSame([], $draft['data']['e_later']['products']);
        $this->assertNull($draft['data']['e_later']['claimed']);
        $this->assertArrayNotHasKey('state', $draft['data']['e_flash']);

        // Once the flash sale ends (no write), the bar falls back to nothing running: left out.
        $this->asVisitorNow();
        Date::setTestNow('2026-11-14T10:30:00+06:00');
        $this->assertArrayNotHasKey('e_flash', $this->elements($this->getJson(self::STORE.'/builder/pages/home')->json('data')));
        $this->actingAsUser($this->t['admin']);
        $this->assertSame('empty', $this->elements($this->getJson(self::DOCS."/{$home}/render")->json('data'))['e_flash']['state']);
    }

    public function test_store_hours_carry_the_store_time_zone_and_category_charts_count_products(): void
    {
        $org = $this->t['organization'];
        $jams = $this->category($org, 'Jams');
        $this->listCategory($jams);
        $plum = $this->category($org, 'Plum jams', $jams);
        $this->listCategory($plum);
        $teas = $this->category($org, 'Teas');
        $this->listCategory($teas);
        $empty = $this->category($org, 'Empty shelf');
        $this->listCategory($empty);
        $this->product('Mango Jam', 'J1', '250.00', [], ['category_id' => $jams]);
        $this->product('Plum Jam', 'J2', '260.00', [], ['category_id' => $plum]);
        $this->product('Green Tea', 'T1', '180.00', [], ['category_id' => $teas]);
        $this->product('Draft Tea', 'T2', '190.00', ['is_published' => false], ['category_id' => $teas]);

        $home = $this->home();
        $chart = fn (string $source, array $extra = []) => $extra + ['data_source' => $source];
        $this->saveDraft($home, [
            $this->el('e_hours', 'store_hours', [], ['translations' => ['bn' => ['title' => 'খোলার সময়']]]),
            $this->el('e_cats', 'chart', $chart('store.products_per_category', ['title' => 'Our range'])),
            $this->el('e_manual', 'chart'),
        ])->assertOk();
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();

        $this->asVisitorNow();
        $page = $this->getJson(self::STORE.'/builder/pages/home')->assertOk()->json('data');
        $this->assertSame(['timezone' => $org->timezone], $page['data']['e_hours']);
        $this->assertNotSame('', $org->timezone);
        // Top-level categories with products on sale (sub-categories counted), largest first.
        $this->assertSame(['labels' => ['Jams', 'Teas'], 'series' => [['id' => 's1', 'name' => 'Products', 'values' => [2, 1]]]], $page['data']['e_cats']);
        // A manual chart has no data and stays.
        $this->assertArrayNotHasKey('e_manual', $page['data']);
        $this->assertSame(['e_hours', 'e_cats', 'e_manual'], array_keys($this->elements($page)));
        $bn = $this->getJson(self::STORE.'/builder/pages/home?lang=bn')->assertOk()->json('data');
        $this->assertSame('পণ্য', $bn['data']['e_cats']['series'][0]['name']);
        $this->assertSame('খোলার সময়', $this->elements($bn)['e_hours']['props']['title']);
        // Only public counts: no sales, revenue, order or customer figures anywhere.
        $this->assertSame(['labels', 'series'], array_keys($page['data']['e_cats']));
    }

    public function test_a_store_without_reviews_or_categories_drops_store_charts_and_review_walls(): void
    {
        $home = $this->home();
        $this->saveDraft($home, [
            $this->el('e_cats', 'chart', ['data_source' => 'store.products_per_category']),
            $this->el('e_ratings', 'chart', ['data_source' => 'store.rating_breakdown']),
            $this->el('e_wall', 'review_wall'),
            $this->el('e_heading', 'heading', ['text' => 'Hello']),
        ])->assertOk();
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();

        $this->asVisitorNow();
        $page = $this->getJson(self::STORE.'/builder/pages/home')->assertOk()->json('data');
        $this->assertSame(['e_heading'], array_keys($this->elements($page)));

        $this->actingAsUser($this->t['admin']);
        $draft = $this->elements($this->getJson(self::DOCS."/{$home}/render")->json('data'));
        foreach (['e_cats', 'e_ratings', 'e_wall'] as $id) {
            $this->assertSame('empty', $draft[$id]['state'], $id);
        }
    }

    public function test_references_must_belong_to_the_organization(): void
    {
        $other = $this->openStore('Mango Mart', 'mango.test');
        $theirPhoto = $this->image('theirs.jpg');
        $theirProduct = $this->makeProduct($other['unit']->id, 'Their Jam', [['TJ', '10.00']]);
        $this->publish($theirProduct['id']);
        $theirSale = $this->makePromotion($other['organization'], ['name' => 'Theirs', 'type' => 'percent', 'value' => '5', 'scope' => 'products', 'target_ids' => [$theirProduct['id']], 'show_countdown' => true, 'ends_at' => '2026-11-14T10:00:00+06:00']);

        $this->actingAsUser($this->t['admin']);
        $mine = $this->image('mine.jpg');
        $mug = $this->product('Mug', 'MUG', '250.00');
        $notCountdown = $this->makePromotion($this->t['organization'], ['name' => 'Plain', 'type' => 'percent', 'value' => '5']);
        $home = $this->home();
        $errors = $this->saveDraft($home, [
            $this->el('e_ba', 'before_after', ['before' => ['media_id' => $mine, 'alt' => ''], 'after' => ['media_id' => $theirPhoto, 'alt' => '']]),
            $this->el('e_team', 'team', ['members' => [['id' => 'm1', 'name' => 'A', 'media_id' => $theirPhoto]]]),
            $this->el('e_grid', 'photo_grid', ['images' => [['id' => 'g1', 'media_id' => $mine], ['id' => 'g2', 'media_id' => $mine], ['id' => 'g3', 'media_id' => $theirPhoto]]]),
            $this->el('e_compare', 'comparison_table', ['columns' => [['id' => 'c1', 'title' => 'A', 'product_id' => $theirProduct['id']], ['id' => 'c2', 'title' => 'B', 'product_id' => $mug['id']]]]),
            $this->el('e_bundle', 'bundle', ['items' => [['id' => 'b1', 'product_id' => $mug['id']], ['id' => 'b2', 'product_id' => $theirProduct['id']]]]),
            $this->el('e_flash', 'flash_sale_bar', ['promotion_id' => $theirSale->id]),
            $this->el('e_plain', 'flash_sale_bar', ['promotion_id' => $notCountdown->id]),
            $this->el('e_wall', 'review_wall', ['source' => 'product', 'product_id' => $theirProduct['id']]),
            $this->el('e_chart', 'chart', ['data_source' => 'store.rating_breakdown', 'source_product_id' => $theirProduct['id']]),
        ])->assertUnprocessable()->assertJsonPath('error.code', 'DOCUMENT_INVALID')->json('error.details.errors');

        $byPath = [];
        foreach ($errors as $error) {
            $byPath[$error['path'].'|'.$error['code']] = $error['ids'];
        }
        $p = 'sections.0.columns.0.elements';
        $this->assertEqualsCanonicalizing([
            "{$p}.0.props.after.media_id|MEDIA_NOT_FOUND",
            "{$p}.1.props.members|MEDIA_NOT_FOUND",
            "{$p}.2.props.images|MEDIA_NOT_FOUND",
            "{$p}.3.props.columns|PRODUCT_NOT_FOUND",
            "{$p}.4.props.items|PRODUCT_NOT_FOUND",
            "{$p}.5.props.promotion_id|PROMOTION_NOT_FOUND",
            "{$p}.6.props.promotion_id|PROMOTION_NOT_FOUND",
            "{$p}.7.props.product_id|PRODUCT_NOT_FOUND",
            "{$p}.8.props.source_product_id|PRODUCT_NOT_FOUND",
        ], array_keys($byPath));
        $this->assertSame([$theirPhoto], $byPath["{$p}.2.props.images|MEDIA_NOT_FOUND"]);
        $this->assertSame([$theirProduct['id']], $byPath["{$p}.3.props.columns|PRODUCT_NOT_FOUND"]);

        // A review wall not set to one product does not check its leftover product id.
        $this->saveDraft($home, [$this->el('e_wall', 'review_wall', ['source' => 'latest', 'product_id' => $theirProduct['id']])])->assertOk();
    }

    public function test_the_canvas_resolver_resolves_the_b8a_data_elements(): void
    {
        $org = $this->t['organization'];
        $mug = $this->product('Mug', 'MUG', '250.00');
        $tea = $this->product('Tea', 'TEA', '180.00');
        $draftOnly = $this->product('Draft Pot', 'POT', '900.00', ['is_published' => false]);
        $flash = $this->makePromotion($org, ['name' => 'Mug sale', 'type' => 'percent', 'value' => '10', 'scope' => 'products', 'target_ids' => [$mug['id']], 'show_countdown' => true, 'ends_at' => '2026-11-14T10:00:00+06:00']);
        $other = $this->openStore('Mango Mart', 'mango.test');
        $theirProduct = $this->makeProduct($other['unit']->id, 'Their Jam', [['TJ', '10.00']]);
        $this->publish($theirProduct['id']);
        $this->actingAsUser($this->t['admin']);
        $this->app->instance(ReviewShowcase::class, new class implements ReviewShowcase
        {
            public function approved(array $productIds, int $minRating, string $order, int $limit, int $bodyMax): array
            {
                return [];
            }

            public function ratingCounts(array $productIds): array
            {
                return ['1' => 0, '2' => 1, '3' => 0, '4' => 2, '5' => 7];
            }
        });

        $response = $this->postJson('/api/v1/storefront/builder/resolve', ['locale' => 'bn', 'elements' => [
            ['id' => 'e_compare', 'type' => 'comparison_table', 'props' => ['columns' => [['id' => 'c1', 'title' => 'A', 'product_id' => $mug['id']], ['id' => 'c2', 'title' => 'B', 'product_id' => $draftOnly['id']]]]],
            ['id' => 'e_bundle', 'type' => 'bundle', 'props' => ['items' => [['id' => 'b1', 'product_id' => $mug['id']], ['id' => 'b2', 'product_id' => $tea['id']]]]],
            ['id' => 'e_flash', 'type' => 'flash_sale_bar', 'props' => ['promotion_id' => $flash->id]],
            ['id' => 'e_hours', 'type' => 'store_hours', 'props' => []],
            ['id' => 'e_ratings', 'type' => 'chart', 'props' => ['data_source' => 'store.rating_breakdown']],
            ['id' => 'e_manual', 'type' => 'chart', 'props' => []],
            ['id' => 'e_wall', 'type' => 'review_wall', 'props' => []],
            ['id' => 'e_their_bundle', 'type' => 'bundle', 'props' => ['items' => [['id' => 'b1', 'product_id' => $mug['id']], ['id' => 'b2', 'product_id' => $theirProduct['id']]]]],
            ['id' => 'e_bad_hours', 'type' => 'store_hours', 'props' => ['days' => []]],
            ['id' => 'e_pricing', 'type' => 'pricing_table', 'props' => []],
        ]])->assertOk()->json('data');

        $this->assertSame([$mug['id']], array_keys($response['data']['e_compare']['products']));
        $this->assertSame(['c2' => ['state' => 'unavailable']], $response['data']['e_compare']['columns']);
        $this->assertSame([$mug['id'], $tea['id']], array_keys($response['data']['e_bundle']['products']));
        $this->assertSame('Mug sale', $response['data']['e_flash']['promotion']['name']);
        $this->assertSame([$mug['id']], array_column($response['data']['e_flash']['products'], 'id'));
        $this->assertSame(['timezone' => $org->timezone], $response['data']['e_hours']);
        // Ratings in the request's language, 5 stars first.
        $this->assertSame(['৫ তারকা', '৪ তারকা', '৩ তারকা', '২ তারকা', '১ তারকা'], $response['data']['e_ratings']['labels']);
        $this->assertSame([['id' => 's1', 'name' => 'রিভিউ', 'values' => [7, 2, 0, 1, 0]]], $response['data']['e_ratings']['series']);
        foreach (['e_manual', 'e_wall'] as $id) {
            $this->assertArrayNotHasKey($id, $response['data']);
        }

        $this->assertSame(['e_their_bundle', 'e_bad_hours', 'e_pricing'], array_keys($response['errors']));
        $this->assertSame(['props.items', 'PRODUCT_NOT_FOUND', [$theirProduct['id']]], [$response['errors']['e_their_bundle'][0]['path'], $response['errors']['e_their_bundle'][0]['code'], $response['errors']['e_their_bundle'][0]['ids']]);
        $this->assertSame('props.days', $response['errors']['e_bad_hours'][0]['path']);
        $this->assertSame('type', $response['errors']['e_pricing'][0]['path']);
    }

    public function test_the_bundle_template_places_the_stores_newest_products(): void
    {
        foreach (['Bowl', 'Vase', 'Candle'] as $i => $name) {
            $this->product($name, "SKU{$i}", '100.00');
        }
        $result = $this->postJson('/api/v1/storefront/builder/templates/neutral-bundle/instantiate', ['context' => 'page'])->assertOk()->json('data');
        $bundle = $result['nodes'][0]['columns'][0]['elements'][0];
        $this->assertSame('bundle', $bundle['type']);
        $this->assertCount(3, $bundle['props']['items']);
        $this->assertSame('একসাথে কেনা হয়', $bundle['translations']['bn']['title']);

        $home = $this->home();
        $revision = $this->getJson(self::DOCS."/{$home}")->json('data.draft_revision');
        $this->putJson(self::DOCS."/{$home}/draft", ['revision' => $revision, 'content' => ['schema_version' => 1, 'sections' => $result['nodes']]])->assertOk();

        // Every B8a template instantiates in a page.
        foreach (['neutral-pricing-plans', 'neutral-before-after', 'neutral-comparison', 'neutral-flash-sale-bar', 'neutral-team', 'neutral-review-wall', 'neutral-photo-grid', 'neutral-store-hours-map', 'neutral-ratings'] as $id) {
            $response = $this->postJson("/api/v1/storefront/builder/templates/{$id}/instantiate", ['context' => 'page']);
            $this->assertSame(200, $response->status(), $id.': '.$response->getContent());
            $this->assertNotEmpty($response->json('data.nodes.0.columns.0.elements'), $id);
        }
    }
}
