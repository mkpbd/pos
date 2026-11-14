<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * B6: the new builder elements end to end — accordion / tabs HTML sanitized on save,
 * references (media, categories, products) owned by the organization, category cards,
 * product spotlights and shop-the-look resolved for visitors and drafts, list translations
 * in the render payload, the canvas resolver, background-video posters, templates that place
 * products, cached payloads with empty objects, and tenant isolation.
 */
class StoreBuilderB6Test extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

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
        return $this->post('/api/v1/media', ['file' => UploadedFile::fake()->image($name, 1200, 800)], $this->spaHeaders())->assertSuccessful()->json('data.id');
    }

    private function home(): string
    {
        return $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home', 'from' => 'blank'])->assertCreated()->json('data.id');
    }

    /**
     * @param  list<array<string, mixed>>  $elements
     * @param  array<string, mixed>  $section  extra section keys
     */
    private function saveDraft(string $id, array $elements, array $section = []): TestResponse
    {
        $revision = $this->getJson(self::DOCS."/{$id}")->assertOk()->json('data.draft_revision');

        return $this->putJson(self::DOCS."/{$id}/draft", ['revision' => $revision, 'content' => ['schema_version' => 1, 'sections' => [$section + [
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

    public function test_accordion_and_tabs_html_is_sanitized_with_its_translations(): void
    {
        $home = $this->home();
        $draft = $this->saveDraft($home, [
            $this->el('e_faq', 'accordion', ['items' => [
                ['id' => 'q1', 'title' => 'Delivery?', 'html' => '<p onclick="steal()">Fast <script>alert(1)</script><strong>delivery</strong></p><iframe src="https://evil.test"></iframe>'],
                ['id' => 'q2', 'title' => 'Empty', 'html' => ''],
            ]], ['translations' => ['bn' => ['items.q1.html' => '<p>দ্রুত<script>x()</script></p>', 'items.q2.html' => '<script>only()</script>', 'items.q1.title' => 'ডেলিভারি?']]]),
            $this->el('e_tabs', 'tabs', ['items' => [
                ['id' => 't1', 'title' => 'Details', 'html' => '<p class="x" style="color:red">Made by <a href="javascript:alert(1)">hand</a></p>'],
                ['id' => 't2', 'title' => 'Care', 'html' => '<p>Wash cold.</p>'],
            ]]),
        ])->assertOk()->json('data.content');

        $faq = $draft['sections'][0]['columns'][0]['elements'][0];
        $html = $faq['props']['items'][0]['html'];
        $this->assertStringContainsString('<strong>delivery</strong>', $html);
        foreach (['<script', 'onclick', '<iframe', 'alert(1)'] as $bad) {
            $this->assertStringNotContainsString($bad, $html);
        }
        $this->assertSame('', $faq['props']['items'][1]['html']);
        // A translation with nothing left is dropped; the others are cleaned.
        $this->assertSame(['bn' => ['items.q1.title' => 'ডেলিভারি?', 'items.q1.html' => '<p>দ্রুত</p>']], $faq['translations']);
        $tabs = $draft['sections'][0]['columns'][0]['elements'][1]['props']['items'][0]['html'];
        foreach (['javascript:', 'class=', 'style='] as $bad) {
            $this->assertStringNotContainsString($bad, $tabs);
        }
        $this->assertStringContainsString('hand', $tabs);
    }

    public function test_cards_spotlights_and_looks_show_live_records_and_drafts_say_why_others_are_hidden(): void
    {
        $org = $this->t['organization'];
        $jams = $this->category($org, 'Jams');
        $this->listCategory($jams);
        $teas = $this->category($org, 'Teas');
        $mango = $this->makeProduct($this->t['unit']->id, 'Mango Jam', [['JAM-S', '250.00', ['Size' => 'Small']], ['JAM-L', '450.00', ['Size' => 'Large']]], ['category_id' => $jams, 'options' => [['name' => 'Size', 'values' => ['Small', 'Large']]]]);
        $this->publish($mango['id'], ['short_description' => 'Sweet and fresh.']);
        $plum = $this->makeProduct($this->t['unit']->id, 'Plum Jam', [['PLUM', '300.00']], ['category_id' => $jams]);
        $this->publish($plum['id']);
        $hidden = $this->makeProduct($this->t['unit']->id, 'Secret Tea', [['TEA', '90.00']]);
        $this->publish($hidden['id'], ['is_published' => false]);
        $photo = $this->image('look.jpg');
        $poster = $this->image('poster.jpg');
        $g1 = $this->image('g1.jpg');

        $home = $this->home();
        $this->saveDraft($home, [
            $this->el('e_jams', 'category_card', ['category_id' => $jams, 'button_label' => 'Shop jams'], ['translations' => ['bn' => ['button_label' => 'জ্যাম কিনুন']]]),
            $this->el('e_teas', 'category_card', ['category_id' => $teas]),
            $this->el('e_spot', 'product_spotlight', ['product_id' => $mango['id'], 'badge' => 'New']),
            $this->el('e_secret', 'product_spotlight', ['product_id' => $hidden['id']]),
            $this->el('e_look', 'shop_the_look', ['media_id' => $photo, 'alt' => 'Breakfast', 'title' => 'Breakfast', 'hotspots' => [
                ['id' => 'h1', 'x' => 20, 'y' => 30, 'product_id' => $mango['id']],
                ['id' => 'h2', 'x' => 50.5, 'y' => 60, 'product_id' => $hidden['id']],
                ['id' => 'h3', 'x' => 80, 'y' => 10.25, 'product_id' => $plum['id']],
            ]]),
            $this->el('e_gallery', 'gallery', ['images' => [['id' => 'g1', 'media_id' => $g1, 'alt' => 'Jars', 'caption' => 'Our jars']]], ['translations' => ['bn' => ['images.g1.caption' => 'আমাদের জার']]]),
            $this->el('e_recent', 'recently_viewed'),
        ], ['style' => ['base' => ['background' => ['type' => 'none', 'video' => ['url' => 'https://youtu.be/dQw4w9WgXcQ', 'poster' => ['media_id' => $poster]]]]]])->assertOk();
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();

        $this->asVisitorNow();
        $page = $this->getJson(self::STORE.'/builder/pages/home')->assertOk()->json('data');
        $elements = $this->elements($page);
        // Hidden category and product: left out; recently viewed has no server data but stays.
        $this->assertSame(['e_jams', 'e_spot', 'e_look', 'e_gallery', 'e_recent'], array_keys($elements));
        $this->assertSame(['name' => 'Jams', 'url' => '/category/jams', 'image' => null, 'product_count' => 2], $page['data']['e_jams']);
        $product = $this->getJson(self::STORE.'/products/'.$page['data']['e_spot']['slug'])->assertOk()->json('data');
        // P1b: the product page object without what only the page itself shows.
        $this->assertSame(array_diff_key($product, array_flip(['delivery', 'zones', 'questions_count'])), $page['data']['e_spot']);
        $this->assertSame(['Small', 'Large'], array_column($page['data']['e_spot']['options'][0]['values'], 'value'));
        $this->assertCount(2, $page['data']['e_spot']['variants']);
        // Shop the look: the cards of the products on sale; the hidden one's spot is gone.
        $this->assertSame([$mango['id'], $plum['id']], array_keys($page['data']['e_look']['products']));
        $this->assertSame('Mango Jam', $page['data']['e_look']['products'][$mango['id']]['name']);
        $this->assertSame(['h1', 'h3'], array_column($elements['e_look']['props']['hotspots'], 'id'));
        $this->assertArrayNotHasKey('e_recent', $page['data']);
        // Media: the look photo, gallery images and the background video poster.
        foreach ([$photo, $g1, $poster] as $id) {
            $this->assertArrayHasKey($id, $page['media']);
        }
        $this->assertSame('dQw4w9WgXcQ', $page['sections'][0]['style']['base']['background']['video']['video_id']);

        // Bangla: list items and props in the request's language.
        $bn = $this->getJson(self::STORE.'/builder/pages/home?lang=bn')->assertOk()->json('data');
        $this->assertSame('আমাদের জার', $this->elements($bn)['e_gallery']['props']['images'][0]['caption']);
        $this->assertSame('Jars', $this->elements($bn)['e_gallery']['props']['images'][0]['alt']);
        $this->assertSame('জ্যাম কিনুন', $this->elements($bn)['e_jams']['props']['button_label']);

        // The draft keeps everything and says why visitors would not see it.
        $this->actingAsUser($this->t['admin']);
        $draft = $this->getJson(self::DOCS."/{$home}/render")->assertOk()->json('data');
        $this->assertSame(['name' => 'Teas', 'url' => null, 'image' => null, 'product_count' => 0, 'state' => 'unavailable'], $draft['data']['e_teas']);
        $this->assertSame('unavailable', $draft['data']['e_secret']['state']);
        $this->assertSame('Secret Tea', $draft['data']['e_secret']['name']);
        $this->assertArrayNotHasKey('preview_state', $draft['data']['e_secret']);
        $this->assertArrayNotHasKey('state', $draft['data']['e_spot']);
        $this->assertSame(['h1', 'h2', 'h3'], array_column($this->elements($draft)['e_look']['props']['hotspots'], 'id'));
        $this->assertArrayNotHasKey($hidden['id'], $draft['data']['e_look']['products']);

        // Unlisting the category takes the card off the page.
        $this->listCategory($jams, ['is_visible' => false]);
        $this->asVisitorNow();
        $this->assertArrayNotHasKey('e_jams', $this->elements($this->getJson(self::STORE.'/builder/pages/home')->json('data')));
    }

    public function test_the_canvas_resolver_resolves_the_shop_elements(): void
    {
        $org = $this->t['organization'];
        $jams = $this->category($org, 'Jams');
        $this->listCategory($jams);
        $mango = $this->makeProduct($this->t['unit']->id, 'Mango Jam', [['JAM', '250.00']], ['category_id' => $jams]);
        $this->publish($mango['id']);
        $draftOnly = $this->makeProduct($this->t['unit']->id, 'Draft Jam', [['DJ', '99.00']]);
        $this->publish($draftOnly['id'], ['is_published' => false]);
        $unlisted = $this->makeProduct($this->t['unit']->id, 'Unlisted Jam', [['UJ', '99.00']]);
        $photo = $this->image();

        $other = $this->openStore('Mango Mart', 'mango.test');
        $theirCategory = $this->category($other['organization'], 'Theirs');
        $theirProduct = $this->makeProduct($other['unit']->id, 'Their Jam', [['TJ', '10.00']]);
        $this->publish($theirProduct['id']);
        $theirPhoto = $this->image('theirs.jpg');
        $this->actingAsUser($this->t['admin']);

        $response = $this->postJson('/api/v1/storefront/builder/resolve', ['locale' => 'bn', 'media_ids' => [$photo, $theirPhoto], 'elements' => [
            ['id' => 'e_card', 'type' => 'category_card', 'props' => ['category_id' => $jams, 'title' => 'Jams'], 'translations' => ['bn' => ['title' => 'জ্যাম']]],
            ['id' => 'e_their_card', 'type' => 'category_card', 'props' => ['category_id' => $theirCategory]],
            ['id' => 'e_spot', 'type' => 'product_spotlight', 'props' => ['product_id' => $mango['id']]],
            ['id' => 'e_draft_spot', 'type' => 'product_spotlight', 'props' => ['product_id' => $draftOnly['id']]],
            ['id' => 'e_unlisted', 'type' => 'product_spotlight', 'props' => ['product_id' => $unlisted['id']]],
            ['id' => 'e_their_spot', 'type' => 'product_spotlight', 'props' => ['product_id' => $theirProduct['id']]],
            ['id' => 'e_look', 'type' => 'shop_the_look', 'props' => ['media_id' => $photo, 'hotspots' => [['id' => 'h1', 'x' => 1, 'y' => 2, 'product_id' => $mango['id']]]]],
            ['id' => 'e_their_look', 'type' => 'shop_the_look', 'props' => ['media_id' => $theirPhoto, 'hotspots' => [['id' => 'h1', 'x' => 1, 'y' => 2, 'product_id' => $theirProduct['id']]]]],
            ['id' => 'e_bad_look', 'type' => 'shop_the_look', 'props' => ['media_id' => $photo, 'hotspots' => [['id' => 'h1', 'x' => 120, 'y' => 2, 'product_id' => $mango['id']]]]],
            ['id' => 'e_gallery', 'type' => 'gallery', 'props' => ['images' => [['id' => 'g1', 'media_id' => $photo]]]],
        ]])->assertOk()->json('data');

        $this->assertSame('Jams', $response['data']['e_card']['name']);
        $this->assertSame(1, $response['data']['e_card']['product_count']);
        $this->assertSame('Mango Jam', $response['data']['e_spot']['name']);
        $this->assertSame('unavailable', $response['data']['e_draft_spot']['state']);
        $this->assertSame([$mango['id']], array_keys($response['data']['e_look']['products']));
        $this->assertArrayHasKey($photo, $response['media']);

        $this->assertSame(['e_their_card', 'e_unlisted', 'e_their_spot', 'e_their_look', 'e_bad_look', 'e_gallery', $theirPhoto], array_keys($response['errors']));
        $this->assertSame('PRODUCT_UNAVAILABLE', $response['errors']['e_unlisted'][0]['code']);
        $this->assertSame(['CATEGORY_NOT_FOUND', [$theirCategory]], [$response['errors']['e_their_card'][0]['code'], $response['errors']['e_their_card'][0]['ids']]);
        $this->assertSame(['props.product_id', 'PRODUCT_NOT_FOUND'], [$response['errors']['e_their_spot'][0]['path'], $response['errors']['e_their_spot'][0]['code']]);
        $this->assertEqualsCanonicalizing(['MEDIA_NOT_FOUND', 'PRODUCT_NOT_FOUND'], array_column($response['errors']['e_their_look'], 'code'));
        $this->assertSame('props.hotspots.0.x', $response['errors']['e_bad_look'][0]['path']);
        $this->assertSame('type', $response['errors']['e_gallery'][0]['path']);
        $this->assertSame('MEDIA_NOT_FOUND', $response['errors'][$theirPhoto][0]['code']);
        foreach (['e_their_card', 'e_their_spot', 'e_their_look', 'e_bad_look'] as $id) {
            $this->assertArrayNotHasKey($id, $response['data']);
        }
        $this->assertArrayNotHasKey($theirPhoto, $response['media']);
    }

    public function test_another_organizations_records_are_refused_like_missing_ones(): void
    {
        $other = $this->openStore('Mango Mart', 'mango.test');
        $theirPhoto = $this->image('theirs.jpg');
        $theirCategory = $this->category($other['organization'], 'Theirs');
        $theirProduct = $this->makeProduct($other['unit']->id, 'Their Jam', [['TJ', '10.00']]);
        $this->publish($theirProduct['id']);

        $this->actingAsUser($this->t['admin']);
        $mine = $this->image('mine.jpg');
        $home = $this->home();
        $errors = $this->saveDraft($home, [
            $this->el('e_gallery', 'gallery', ['images' => [['id' => 'g1', 'media_id' => $mine], ['id' => 'g2', 'media_id' => $theirPhoto]]]),
            $this->el('e_carousel', 'image_carousel', ['images' => [['id' => 'k1', 'media_id' => $theirPhoto]]]),
            $this->el('e_logos', 'logo_carousel', ['logos' => [['id' => 'o1', 'media_id' => $mine], ['id' => 'o2', 'media_id' => $theirPhoto]]]),
            $this->el('e_card', 'category_card', ['category_id' => $theirCategory, 'media_id' => $theirPhoto]),
            $this->el('e_spot', 'product_spotlight', ['product_id' => $theirProduct['id']]),
            $this->el('e_look', 'shop_the_look', ['media_id' => $mine, 'hotspots' => [['id' => 'h1', 'x' => 5, 'y' => 5, 'product_id' => $theirProduct['id']]]]),
        ], ['style' => ['base' => ['background' => ['type' => 'none', 'video' => ['url' => 'https://vimeo.com/76979871', 'poster' => ['media_id' => $theirPhoto]]]]]])
            ->assertUnprocessable()->assertJsonPath('error.code', 'DOCUMENT_INVALID')->json('error.details.errors');

        $byPath = [];
        foreach ($errors as $error) {
            $byPath[$error['path'].'|'.$error['code']] = $error['ids'];
        }
        $p = 'sections.0.columns.0.elements';
        $this->assertEqualsCanonicalizing([
            'sections.0.style|MEDIA_NOT_FOUND',
            "{$p}.0.props.images|MEDIA_NOT_FOUND",
            "{$p}.1.props.images|MEDIA_NOT_FOUND",
            "{$p}.2.props.logos|MEDIA_NOT_FOUND",
            "{$p}.3.props.media_id|MEDIA_NOT_FOUND",
            "{$p}.3.props.category_id|CATEGORY_NOT_FOUND",
            "{$p}.4.props.product_id|PRODUCT_NOT_FOUND",
            "{$p}.5.props.hotspots|PRODUCT_NOT_FOUND",
        ], array_keys($byPath));
        $this->assertSame([$theirPhoto], $byPath["{$p}.0.props.images|MEDIA_NOT_FOUND"]);
        $this->assertSame([$theirProduct['id']], $byPath["{$p}.5.props.hotspots|PRODUCT_NOT_FOUND"]);

        // Their own records are fine in their store, and Berry's page never shows Mango's data.
        $this->saveDraft($home, [$this->el('e_gallery', 'gallery', ['images' => [['id' => 'g1', 'media_id' => $mine]]])])->assertOk();
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();
        $this->actingAsUser($other['admin']);
        $this->getJson(self::DOCS."/{$home}")->assertNotFound();
        $this->asVisitorNow();
        $this->getJson('http://mango.test/api/v1/store/builder/pages/home')->assertNotFound();
    }

    public function test_a_sticky_section_is_saved_once_per_page_with_its_shapes(): void
    {
        $home = $this->home();
        $section = fn (string $id, array $props) => ['id' => $id, 'type' => 'section', 'props' => $props, 'columns' => [['id' => "c{$id}", 'width' => ['base' => 100], 'elements' => [['id' => "e{$id}", 'type' => 'heading', 'props' => ['text' => 'Hi']]]]]];
        $revision = fn () => $this->getJson(self::DOCS."/{$home}")->json('data.draft_revision');

        $this->putJson(self::DOCS."/{$home}/draft", ['revision' => $revision(), 'content' => ['schema_version' => 1, 'sections' => [
            $section('s_a', ['sticky' => true]), $section('s_b', ['sticky' => true]),
        ]]])->assertUnprocessable()->assertJsonPath('error.details.errors.0.path', 'sections.1.props.sticky')->assertJsonPath('error.details.errors.0.node_id', 's_b');

        $saved = $this->putJson(self::DOCS."/{$home}/draft", ['revision' => $revision(), 'content' => ['schema_version' => 1, 'sections' => [
            $section('s_a', ['sticky' => true, 'shape_bottom' => ['shape' => 'wave', 'color' => 'theme:surface', 'height' => 48, 'flip' => false]]),
            $section('s_b', ['layout' => 'full']),
        ]]])->assertOk()->json('data.content.sections');
        $this->assertSame(['layout' => 'boxed', 'anchor' => null, 'sticky' => true, 'shape_bottom' => ['shape' => 'wave', 'color' => 'theme:surface', 'height' => 48, 'flip' => false]], $saved[0]['props']);
        $this->assertSame(['layout' => 'full', 'anchor' => null], $saved[1]['props']);
    }

    public function test_cached_pages_keep_their_empty_objects_and_product_options(): void
    {
        // A serializing cache store (like the database / Redis stores in production).
        config(['cache.stores.array.serialize' => true]);
        $this->app['cache']->forgetDriver('array');
        $this->app->forgetInstance('cache.store');

        $mango = $this->makeProduct($this->t['unit']->id, 'Mango Jam', [['JAM', '250.00']]);
        $this->publish($mango['id']);
        $home = $this->home();
        $this->saveDraft($home, [
            $this->el('e_spot', 'product_spotlight', ['product_id' => $mango['id']]),
            $this->el('e_quote', 'quote', ['text' => 'Lovely jam.']),
        ])->assertOk();
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();

        $this->asVisitorNow();
        $first = $this->getJson(self::STORE.'/builder/pages/home')->assertOk();
        $second = $this->getJson(self::STORE.'/builder/pages/home')->assertOk();
        $this->assertSame($first->json('data'), $second->json('data'));
        $json = (string) $second->getContent();
        $this->assertStringNotContainsString('__PHP_Incomplete_Class', $json);
        $this->assertStringContainsString('"media":{}', $json);
        $this->assertStringContainsString('"option_values":{}', $json);
    }

    public function test_the_shop_the_look_template_places_the_stores_featured_products(): void
    {
        $products = [];
        foreach (['Bowl', 'Vase', 'Candle'] as $i => $name) {
            $products[] = $id = $this->makeProduct($this->t['unit']->id, $name, [["SKU{$i}", '100.00']])['id'];
            $this->publish($id, ['is_featured' => true]);
        }
        $result = $this->postJson('/api/v1/storefront/builder/templates/neutral-shop-the-look/instantiate', ['context' => 'page'])->assertOk()->json('data');
        $look = $result['nodes'][0]['columns'][0]['elements'][0];
        $this->assertSame('shop_the_look', $look['type']);
        $this->assertEqualsCanonicalizing($products, array_column($look['props']['hotspots'], 'product_id'));
        $this->assertSame(1, $result['imported']['media']);

        $home = $this->home();
        $revision = $this->getJson(self::DOCS."/{$home}")->json('data.draft_revision');
        $this->putJson(self::DOCS."/{$home}/draft", ['revision' => $revision, 'content' => ['schema_version' => 1, 'sections' => $result['nodes']]])->assertOk();

        // A store with fewer products gets fewer spots; one without any gets no look at all.
        $other = $this->openStore('Empty Shop', 'empty.test');
        $this->assertNotNull($other['admin']);
        $empty = $this->postJson('/api/v1/storefront/builder/templates/neutral-shop-the-look/instantiate', ['context' => 'page'])->assertOk()->json('data');
        $this->assertSame([], $empty['nodes'][0]['columns'][0]['elements']);
    }
}
