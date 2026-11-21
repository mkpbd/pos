<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * B19 (scroll stories) end to end: scroll effects, the moving section background, Ken Burns,
 * scroll stories, horizontal galleries and the reading progress bar survive save and publish and
 * reach shoppers (in Bangla too); a gallery of products shows only products on sale (drafts say
 * which are not); references must be the organization's; the canvas resolver and the registry
 * endpoint; the page check's SCROLL_STORY_MEDIA, SCROLL_EFFECT_TOP and HORIZONTAL_GALLERY_LONG.
 * PostgreSQL.
 */
class StoreBuilderB19Test extends TestCase
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
     * @param  array<string, mixed>  $extra
     * @return array<string, mixed>
     */
    private function section(string $id, array $elements, array $extra = []): array
    {
        return $extra + ['id' => $id, 'type' => 'section', 'columns' => [['id' => 'c'.$id, 'width' => ['base' => 100], 'elements' => $elements]]];
    }

    /**
     * @param  array<string, mixed>  $props
     * @param  array<string, mixed>  $extra
     * @return array<string, mixed>
     */
    private function el(string $id, string $type, array $props = [], array $extra = []): array
    {
        return $extra + ['id' => $id, 'type' => $type, 'props' => $props];
    }

    /**
     * @param  array<string, mixed>  $content
     */
    private function save(string $id, array $content): TestResponse
    {
        $revision = $this->getJson(self::DOCS."/{$id}")->assertOk()->json('data.draft_revision');

        return $this->putJson(self::DOCS."/{$id}/draft", ['revision' => $revision, 'content' => ['schema_version' => 1] + $content]);
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

    /**
     * @return array<string, list<array<string, mixed>>>
     */
    private function check(string $id, array $content): array
    {
        $issues = $this->postJson(self::DOCS."/{$id}/check", ['content' => ['schema_version' => 1] + $content])->assertOk()->json('data.issues');
        $codes = [];
        foreach ($issues as $issue) {
            $codes[$issue['code']][] = $issue;
        }

        return $codes;
    }

    private function product(string $name, string $sku, array $listing = []): array
    {
        $product = $this->makeProduct($this->t['unit']->id, $name, [[$sku, '250.00']]);
        $this->publish($product['id'], $listing);

        return $product;
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private static function step(string $id, ?string $media, array $overrides = []): array
    {
        return $overrides + ['id' => $id, 'media_id' => $media, 'alt' => 'Photo '.$id, 'kicker' => 'Step', 'heading' => 'Heading '.$id, 'text' => 'Text '.$id, 'link' => null];
    }

    public function test_scroll_keys_survive_save_and_publish_and_reach_shoppers_in_bangla(): void
    {
        $photo = $this->image('a.jpg');
        $photo2 = $this->image('b.jpg');
        $home = $this->home();
        $content = ['scroll_progress' => ['position' => 'bottom', 'thickness' => 4], 'sections' => [
            $this->section('s_top', [
                $this->el('e_img', 'image', ['media_id' => $photo, 'alt' => 'Shop', 'ken_burns' => 'slow', 'ken_burns_direction' => 'out']),
            ], ['props' => ['background_scroll' => 'zoom_in'], 'style' => ['base' => ['background' => ['type' => 'image', 'image' => ['media_id' => $photo], 'parallax' => 'slow']]]]),
            $this->section('s_story', [
                $this->el('e_head', 'heading', ['text' => 'Our story'], ['style' => ['base' => ['scroll' => ['effect' => 'reveal_up', 'intensity' => 'subtle']]]]),
                $this->el('e_story', 'scroll_story', ['steps' => [
                    self::step('s1', $photo),
                    self::step('s2', $photo2, ['link' => ['label' => 'Shop', 'url' => '/shop']]),
                ], 'media_side' => 'right'], ['translations' => ['bn' => ['steps.s1.heading' => 'শুরু', 'steps.s2.link.label' => 'কিনুন']]]),
                $this->el('e_gal', 'horizontal_gallery', ['items' => [
                    ['id' => 'g1', 'media_id' => $photo, 'alt' => 'One', 'caption' => 'First'],
                    ['id' => 'g2', 'media_id' => null, 'alt' => '', 'caption' => 'Not chosen yet'],
                    ['id' => 'g3', 'media_id' => $photo2, 'alt' => 'Three', 'caption' => 'Third', 'link' => ['url' => '/shop']],
                ], 'card_width' => 'small'], ['translations' => ['bn' => ['items.g1.caption' => 'প্রথম']]]),
            ]),
        ]];
        $draft = $this->save($home, $content)->assertOk()->json('data.content');
        $this->assertEquals(['position' => 'bottom', 'color_role' => 'primary', 'thickness' => 4], $draft['scroll_progress']);
        $this->assertSame('zoom_in', $draft['sections'][0]['props']['background_scroll']);
        $this->assertArrayNotHasKey('parallax', $draft['sections'][0]['style']['base']['background']);
        $this->assertSame(['slow', 'out'], [$draft['sections'][0]['columns'][0]['elements'][0]['props']['ken_burns'], $draft['sections'][0]['columns'][0]['elements'][0]['props']['ken_burns_direction']]);
        $this->assertEquals(['effect' => 'reveal_up', 'intensity' => 'subtle'], $draft['sections'][1]['columns'][0]['elements'][0]['style']['base']['scroll']);
        // Saving what came back changes nothing.
        $this->assertEquals($draft, $this->save($home, $draft)->assertOk()->json('data.content'));

        // The draft render keeps the picture not chosen yet.
        $render = $this->getJson(self::DOCS."/{$home}/render")->assertOk()->json('data');
        $this->assertSame(['g1', 'g2', 'g3'], array_column($this->elements($render)['e_gal']['props']['items'], 'id'));
        $this->assertEquals(['position' => 'bottom', 'color_role' => 'primary', 'thickness' => 4], $render['document']['scroll_progress']);

        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();
        $this->app['auth']->forgetGuards();
        $page = $this->getJson(self::STORE.'/builder/pages/home')->assertOk()->json('data');
        $this->assertEquals(['position' => 'bottom', 'color_role' => 'primary', 'thickness' => 4], $page['document']['scroll_progress']);
        $elements = $this->elements($page);
        $this->assertSame('zoom_in', $page['sections'][0]['props']['background_scroll']);
        $this->assertSame('slow', $elements['e_img']['props']['ken_burns']);
        $this->assertSame('reveal_up', $elements['e_head']['style']['base']['scroll']['effect']);
        $this->assertSame(['s1', 's2'], array_column($elements['e_story']['props']['steps'], 'id'));
        $this->assertSame('right', $elements['e_story']['props']['media_side']);
        // Shoppers only see the pictures that were chosen.
        $this->assertSame(['g1', 'g3'], array_column($elements['e_gal']['props']['items'], 'id'));
        foreach ([$photo, $photo2] as $media) {
            $this->assertArrayHasKey($media, $page['media']);
        }

        $bn = $this->elements($this->getJson(self::STORE.'/builder/pages/home?lang=bn')->assertOk()->json('data'));
        $this->assertSame(['শুরু', 'Heading s2'], array_column($bn['e_story']['props']['steps'], 'heading'));
        $this->assertSame('কিনুন', $bn['e_story']['props']['steps'][1]['link']['label']);
        $this->assertSame('প্রথম', $bn['e_gal']['props']['items'][0]['caption']);
    }

    public function test_a_gallery_of_products_shows_products_on_sale_and_drafts_say_which_are_not(): void
    {
        $mug = $this->product('Mug', 'MUG');
        $tea = $this->product('Tea', 'TEA');
        $hidden = $this->product('Secret Pot', 'POT', ['is_published' => false]);
        $other = $this->product('Other Pot', 'OTH', ['is_published' => false]);
        $home = $this->home();
        $this->save($home, ['sections' => [$this->section('s_main', [
            $this->el('e_gal', 'horizontal_gallery', ['source' => 'products', 'product_ids' => [$mug['id'], $hidden['id'], $tea['id']]]),
            $this->el('e_none', 'horizontal_gallery', ['source' => 'products', 'product_ids' => [$hidden['id'], $other['id']]]),
            $this->el('e_pics', 'horizontal_gallery', ['items' => [['id' => 'g1', 'media_id' => null], ['id' => 'g2', 'media_id' => null]]]),
        ])]])->assertOk();

        $draft = $this->getJson(self::DOCS."/{$home}/render")->assertOk()->json('data');
        $this->assertSame([$mug['id'], $tea['id']], array_keys($draft['data']['e_gal']['products']));
        $this->assertSame('Mug', $draft['data']['e_gal']['products'][$mug['id']]['name']);
        $this->assertSame([$hidden['id']], $draft['data']['e_gal']['unavailable']);
        $this->assertArrayNotHasKey('state', $draft['data']['e_gal']);
        $this->assertSame('empty', $draft['data']['e_none']['state']);
        $this->assertArrayNotHasKey('e_pics', $draft['data']);
        $this->assertSame([$mug['id'], $hidden['id'], $tea['id']], $this->elements($draft)['e_gal']['props']['product_ids']);

        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();
        $this->app['auth']->forgetGuards();
        $page = $this->getJson(self::STORE.'/builder/pages/home')->assertOk()->json('data');
        $elements = $this->elements($page);
        // No product on sale, or no picture chosen: left out.
        $this->assertSame(['e_gal'], array_keys($elements));
        $this->assertSame([$mug['id'], $tea['id']], $elements['e_gal']['props']['product_ids']);
        $this->assertSame([$mug['id'], $tea['id']], array_keys($page['data']['e_gal']['products']));
        $this->assertArrayNotHasKey('unavailable', $page['data']['e_gal']);

        // The canvas resolver resolves a gallery of products too.
        $this->actingAsUser($this->t['admin']);
        $resolved = $this->postJson('/api/v1/storefront/builder/resolve', ['elements' => [
            ['id' => 'e_gal', 'type' => 'horizontal_gallery', 'props' => ['source' => 'products', 'product_ids' => [$tea['id'], $hidden['id']]]],
        ]])->assertOk()->json('data');
        $this->assertSame([$tea['id']], array_keys($resolved['data']['e_gal']['products']));
        $this->assertSame([$hidden['id']], $resolved['data']['e_gal']['unavailable']);
    }

    public function test_references_must_belong_to_the_organization_and_invalid_keys_are_refused(): void
    {
        $other = $this->openStore('Mango Mart', 'mango.test');
        $theirPhoto = $this->image('theirs.jpg');
        $theirProduct = $this->makeProduct($other['unit']->id, 'Their Jam', [['TJ', '10.00']]);
        $this->publish($theirProduct['id']);

        $this->actingAsUser($this->t['admin']);
        $mine = $this->image('mine.jpg');
        $mug = $this->product('Mug', 'MUG');
        $home = $this->home();
        $errors = $this->save($home, ['sections' => [$this->section('s_main', [
            $this->el('e_story', 'scroll_story', ['steps' => [self::step('s1', $mine), self::step('s2', $theirPhoto)]]),
            $this->el('e_pics', 'horizontal_gallery', ['items' => [['id' => 'g1', 'media_id' => $theirPhoto], ['id' => 'g2', 'media_id' => $mine]]]),
            $this->el('e_prods', 'horizontal_gallery', ['source' => 'products', 'product_ids' => [$mug['id'], $theirProduct['id']]]),
        ])]])->assertUnprocessable()->assertJsonPath('error.code', 'DOCUMENT_INVALID')->json('error.details.errors');
        $byPath = [];
        foreach ($errors as $error) {
            $byPath[$error['path'].'|'.$error['code']] = $error['ids'];
        }
        $p = 'sections.0.columns.0.elements';
        $this->assertSame([
            "{$p}.0.props.steps|MEDIA_NOT_FOUND" => [$theirPhoto],
            "{$p}.1.props.items|MEDIA_NOT_FOUND" => [$theirPhoto],
            "{$p}.2.props.product_ids|PRODUCT_NOT_FOUND" => [$theirProduct['id']],
        ], $byPath);

        // Invalid B19 keys are refused with their paths.
        $paths = array_column($this->save($home, ['scroll_progress' => ['thickness' => 9], 'sections' => [$this->section('s_main', [
            $this->el('e_img', 'image', ['media_id' => $mine, 'ken_burns' => 'fast']),
        ], ['props' => ['background_scroll' => 'spin']])]])->assertUnprocessable()->json('error.details.errors'), 'path');
        $this->assertEqualsCanonicalizing(['scroll_progress.thickness', 'sections.0.props.background_scroll', "{$p}.0.props.ken_burns"], $paths);

        // A header has no reading progress bar.
        $header = $this->postJson(self::DOCS, ['kind' => 'header', 'key' => 'header', 'title' => 'Header'])->assertCreated()->json('data.id');
        $this->save($header, ['scroll_progress' => ['position' => 'top'], 'sections' => []])->assertUnprocessable()->assertJsonPath('error.details.errors.0.path', 'scroll_progress');
    }

    public function test_the_registry_endpoint_lists_the_b19_enums_and_elements(): void
    {
        $data = $this->getJson('/api/v1/storefront/builder/elements')->assertOk()->json('data');
        $types = array_column($data['types'], null, 'type');
        $this->assertSame('media', $types['scroll_story']['group']);
        $this->assertSame(['page', 'cms', 'zone', 'template'], $types['horizontal_gallery']['allowed_in']);
        $this->assertSame('source=products', $data['data_when']['horizontal_gallery']);
        $this->assertContains('reveal_circle', $data['enums']['scroll_effects']);
        $this->assertSame(['none', 'zoom_in', 'zoom_out', 'pan_up', 'pan_down'], $data['enums']['background_scrolls']);
        $this->assertSame(['min' => 2, 'max' => 6], $data['limits']['scroll_progress_thickness']);
    }

    public function test_page_check_warns_about_story_pictures_late_top_content_and_long_pinned_galleries(): void
    {
        $photo = $this->image();
        $home = $this->home();
        $scroll = ['style' => ['base' => ['scroll' => ['effect' => 'fade']]]];
        $items = fn (int $n) => array_map(fn (int $i) => ['id' => "g{$i}", 'media_id' => $photo, 'alt' => "Photo {$i}"], range(1, $n));
        $codes = $this->check($home, ['sections' => [
            $this->section('s_top', [
                $this->el('e_img', 'image', ['media_id' => $photo, 'alt' => 'x'], $scroll),
                $this->el('e_head', 'heading', ['text' => 'Hello'], $scroll),
                $this->el('e_head2', 'heading', ['text' => 'Second heading'], $scroll),
            ], $scroll),
            $this->section('s_next', [
                $this->el('e_late', 'heading', ['text' => 'Below'], $scroll),
                $this->el('e_story', 'scroll_story', ['steps' => [self::step('s1', $photo), self::step('s2', null), self::step('s3', $photo, ['alt' => ' '])]]),
                $this->el('e_long', 'horizontal_gallery', ['items' => $items(9)]),
                $this->el('e_unpinned', 'horizontal_gallery', ['items' => $items(12), 'pin' => false]),
                $this->el('e_ok', 'horizontal_gallery', ['items' => $items(8)]),
                $this->el('e_hidden', 'scroll_story', ['steps' => [self::step('s1', null), self::step('s2', null)]], ['hidden' => true]),
            ]),
        ]]);

        // The first section, its first picture and its first heading — not the rest.
        $top = array_column($codes['SCROLL_EFFECT_TOP'], null, 'node_id');
        $this->assertSame(['s_top', 'e_img', 'e_head'], array_keys($top));
        $this->assertSame('warning', $top['e_img']['severity']);
        $this->assertSame(['kind' => 'image', 'effect' => 'fade', 'fix' => 'remove_scroll_effect'], array_intersect_key($top['e_img']['details'], array_flip(['kind', 'effect', 'fix'])));
        $this->assertSame('style.base.scroll.effect', $top['e_head']['details']['field']);

        $this->assertCount(1, $codes['SCROLL_STORY_MEDIA']);
        $story = $codes['SCROLL_STORY_MEDIA'][0];
        $this->assertSame(['e_story', 'warning', ['s2', 's3'], 'props.steps'], [$story['node_id'], $story['severity'], $story['details']['steps'], $story['details']['field']]);

        $this->assertCount(1, $codes['HORIZONTAL_GALLERY_LONG']);
        $long = $codes['HORIZONTAL_GALLERY_LONG'][0];
        $this->assertSame(['e_long', 9, 8, 'turn_off_pin', 'props.pin'], [$long['node_id'], $long['details']['count'], $long['details']['limit'], $long['details']['fix'], $long['details']['field']]);

        // A clean page has none of them.
        $clean = $this->check($home, ['sections' => [$this->section('s_top', [$this->el('e_head', 'heading', ['text' => 'Hello'])]), $this->section('s_next', [$this->el('e_late', 'heading', ['text' => 'Below'], $scroll)])]]);
        $this->assertArrayNotHasKey('SCROLL_EFFECT_TOP', $clean);
    }
}
