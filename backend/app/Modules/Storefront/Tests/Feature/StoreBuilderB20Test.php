<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Storefront\Tests\Concerns\PublishesTheme;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * B20 (animated graphics) end to end: animated icons, illustrations and moving backgrounds
 * survive save and publish and reach shoppers (in Bangla too); invalid keys are refused with
 * their paths; the registry endpoint; the page check's BACKGROUND_FX_MANY, ICON_LOOP_MANY and
 * ILLUSTRATION_TOP; the theme's store-wide `effects` through the theme endpoints (optional,
 * audited, kept by presets, per store) and in the bootstrap. PostgreSQL.
 */
class StoreBuilderB20Test extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, PublishesTheme, RefreshDatabase;

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
     * @return array<string, mixed>
     */
    private static function fx(string $type = 'snow'): array
    {
        return ['style' => ['base' => ['background_fx' => ['type' => $type]]]];
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
                    foreach ($element['columns'] ?? [] as $inner) {
                        foreach ($inner['elements'] as $child) {
                            $result[$child['id']] = $child;
                        }
                    }
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

    public function test_animated_graphics_survive_save_and_publish_and_reach_shoppers_in_bangla(): void
    {
        $home = $this->home();
        $fx = ['type' => 'confetti_fall', 'density' => 'low', 'speed' => 'normal', 'colors' => ['primary', 'accent']];
        $content = ['sections' => [
            $this->section('s_top', [
                $this->el('e_icon', 'animated_icon', ['name' => 'cash_on_delivery', 'animation' => 'pop', 'trigger' => 'hover', 'size' => 96, 'stroke' => 1, 'color_role' => 'custom', 'color' => '#0F766E', 'background' => 'circle', 'label' => 'Cash on delivery'], ['translations' => ['bn' => ['label' => 'ক্যাশ অন ডেলিভারি']]]),
                $this->el('e_ill', 'illustration', ['name' => 'gift_unwrap', 'play' => 'hover', 'size' => 'small', 'align' => 'left', 'palette' => 'mono', 'alt' => 'A gift opening'], ['translations' => ['bn' => ['alt' => 'উপহার খোলা হচ্ছে']]]),
                $this->el('e_row', 'inner_row', [], ['style' => ['base' => ['background_fx' => ['type' => 'bubbles']]], 'columns' => [
                    ['id' => 'c_in', 'width' => ['base' => 100], 'elements' => [$this->el('e_deco', 'animated_icon', ['name' => 'leaf'])]],
                ]]),
            ], ['style' => ['base' => ['background_fx' => $fx]]]),
        ]];
        $draft = $this->save($home, $content)->assertOk()->json('data.content');
        $this->assertEquals($fx, $draft['sections'][0]['style']['base']['background_fx']);
        $elements = $this->elements($draft);
        $this->assertSame(['custom', '#0f766e'], [$elements['e_icon']['props']['color_role'], $elements['e_icon']['props']['color']]);
        $this->assertSame(['type' => 'bubbles'], $elements['e_row']['style']['base']['background_fx']);
        $this->assertArrayNotHasKey('color', $elements['e_deco']['props']);
        // Saving what came back changes nothing.
        $this->assertEquals($draft, $this->save($home, $draft)->assertOk()->json('data.content'));

        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();
        $this->app['auth']->forgetGuards();
        $page = $this->getJson(self::STORE.'/builder/pages/home')->assertOk()->json('data');
        $this->assertEquals($fx, $page['sections'][0]['style']['base']['background_fx']);
        $elements = $this->elements($page);
        $this->assertSame('Cash on delivery', $elements['e_icon']['props']['label']);
        $this->assertSame(['gift_unwrap', 'hover', 'small', 'left', 'mono'], [$elements['e_ill']['props']['name'], $elements['e_ill']['props']['play'], $elements['e_ill']['props']['size'], $elements['e_ill']['props']['align'], $elements['e_ill']['props']['palette']]);
        $this->assertSame('', $elements['e_deco']['props']['label']);
        $this->assertArrayNotHasKey('e_icon', $page['data'] ?? []);

        $bn = $this->elements($this->getJson(self::STORE.'/builder/pages/home?lang=bn')->assertOk()->json('data'));
        $this->assertSame('ক্যাশ অন ডেলিভারি', $bn['e_icon']['props']['label']);
        $this->assertSame('উপহার খোলা হচ্ছে', $bn['e_ill']['props']['alt']);
    }

    public function test_invalid_animated_graphics_are_refused_and_illustrations_stay_out_of_the_header(): void
    {
        $home = $this->home();
        $p = 'sections.0.columns.0.elements';
        $paths = array_column($this->save($home, ['sections' => [$this->section('s_main', [
            $this->el('e_icon', 'animated_icon', ['name' => 'bkash', 'trigger' => 'always', 'size' => 200, 'color_role' => 'custom']),
            $this->el('e_ill', 'illustration', ['name' => 'castle', 'play' => 'twice', 'alt' => str_repeat('x', 201)]),
        ])]])->assertUnprocessable()->assertJsonPath('error.code', 'DOCUMENT_INVALID')->json('error.details.errors'), 'path');
        $this->assertEqualsCanonicalizing([
            "{$p}.0.props.name", "{$p}.0.props.trigger", "{$p}.0.props.size", "{$p}.0.props.color",
            "{$p}.1.props.name", "{$p}.1.props.play", "{$p}.1.props.alt",
        ], $paths);

        // A broken moving background is dropped silently, like other style values.
        $saved = $this->save($home, ['sections' => [$this->section('s_main', [], ['style' => ['base' => ['background_fx' => ['type' => 'fireworks']]]])]])->assertOk()->json('data.content');
        $this->assertSame([], $saved['sections'][0]['style']);

        // The header takes animated icons, not illustrations.
        $header = $this->postJson(self::DOCS, ['kind' => 'header', 'key' => 'header', 'title' => 'Header'])->assertCreated()->json('data.id');
        $this->save($header, ['sections' => [$this->section('s_h', [$this->el('e_icon', 'animated_icon', ['name' => 'phone'])])]])->assertOk();
        $this->save($header, ['sections' => [$this->section('s_h', [$this->el('e_ill', 'illustration')])]])
            ->assertUnprocessable()->assertJsonPath('error.details.errors.0.code', 'ELEMENT_NOT_ALLOWED');
    }

    public function test_the_registry_endpoint_lists_the_b20_enums_and_elements(): void
    {
        $data = $this->getJson('/api/v1/storefront/builder/elements')->assertOk()->json('data');
        $types = array_column($data['types'], null, 'type');
        $this->assertSame('media', $types['animated_icon']['group']);
        $this->assertSame(['page', 'cms', 'header', 'footer', 'zone', 'template', 'popup'], $types['animated_icon']['allowed_in']);
        $this->assertSame(['page', 'cms', 'zone', 'template', 'popup'], $types['illustration']['allowed_in']);
        $this->assertSame(['label'], $types['animated_icon']['translatable']);
        $this->assertContains('rickshaw_van', $data['enums']['animated_icon_names']);
        $this->assertSame('delivery', $data['enums']['animated_icon_groups'][0]['key']);
        $this->assertContains('রিকশা', $data['enums']['animated_icon_keywords']['rickshaw_van']['bn']);
        $this->assertContains('eid_lanterns', $data['enums']['illustration_names']);
        $this->assertContains('confetti_fall', $data['enums']['background_fx_types']);
        $this->assertSame(['fly', 'bump', 'none'], $data['enums']['theme_add_to_cart_effects']);
        $this->assertSame(['min' => 24, 'max' => 160], $data['limits']['animated_icon_size']);
    }

    public function test_starter_sections_can_be_inserted(): void
    {
        $templates = array_column($this->getJson('/api/v1/storefront/builder/templates?scope=section')->assertOk()->json('data'), null, 'id');
        $this->assertSame('features', $templates['neutral-why-us-animated']['category']);
        $this->assertSame('promo', $templates['neutral-delivery-banner']['category']);

        $home = $this->home();
        $sections = [];
        foreach (['neutral-why-us-animated', 'neutral-delivery-banner'] as $id) {
            array_push($sections, ...$this->postJson("/api/v1/storefront/builder/templates/{$id}/instantiate", ['context' => 'page'])->assertOk()->json('data.nodes'));
        }
        $draft = $this->save($home, ['sections' => $sections])->assertOk()->json('data.content');
        $this->assertSame('floating_shapes', $draft['sections'][1]['style']['base']['background_fx']['type']);
        $types = array_column($this->elements($draft), 'type');
        $this->assertSame(4, count(array_keys($types, 'animated_icon', true)));
        $this->assertContains('illustration', $types);
    }

    public function test_page_check_warns_about_too_many_moving_backgrounds_and_looping_icons_and_a_looping_top_illustration(): void
    {
        $home = $this->home();
        $loop = fn (string $id, array $props = []) => $this->el($id, 'animated_icon', $props + ['trigger' => 'loop', 'animation' => 'pulse']);
        $codes = $this->check($home, ['sections' => [
            $this->section('s_top', [
                $this->el('e_top', 'illustration', ['play' => 'loop']),
                $this->el('e_calm', 'illustration', ['play' => 'view']),
                $loop('e_l1'), $loop('e_l2'), $loop('e_l3'),
            ], self::fx()),
            $this->section('s_two', [
                $this->el('e_late', 'illustration', ['play' => 'loop']),
                $loop('e_l4'), $loop('e_l5'), $loop('e_l6'), $loop('e_l7'),
                // Not looping, or still: not counted.
                $loop('e_still', ['animation' => 'none']),
                $this->el('e_once', 'animated_icon', ['trigger' => 'view']),
                $loop('e_hidden') + ['hidden' => true],
                $this->el('e_row', 'inner_row', [], self::fx('stars') + ['columns' => [['id' => 'c_in', 'width' => ['base' => 100], 'elements' => []]]]),
            ], self::fx('petals')),
            $this->section('s_hidden', [], self::fx('bubbles') + ['hidden' => true]),
        ]]);

        $this->assertCount(1, $codes['BACKGROUND_FX_MANY']);
        $fx = $codes['BACKGROUND_FX_MANY'][0];
        $this->assertSame(['warning', null, ['s_top', 's_two', 'e_row'], 3, 2], [$fx['severity'], $fx['node_id'], $fx['details']['ids'], $fx['details']['count'], $fx['details']['limit']]);

        $this->assertCount(1, $codes['ICON_LOOP_MANY']);
        $icons = $codes['ICON_LOOP_MANY'][0];
        $this->assertSame(['warning', null, ['e_l1', 'e_l2', 'e_l3', 'e_l4', 'e_l5', 'e_l6', 'e_l7'], 7, 6], [$icons['severity'], $icons['node_id'], $icons['details']['ids'], $icons['details']['count'], $icons['details']['limit']]);

        // Only the looping illustration of the first section.
        $this->assertCount(1, $codes['ILLUSTRATION_TOP']);
        $top = $codes['ILLUSTRATION_TOP'][0];
        $this->assertSame(['e_top', 'warning', 'props.play', 'loop', 'set_play_view'], [$top['node_id'], $top['severity'], $top['details']['field'], $top['details']['play'], $top['details']['fix']]);

        // At the limits nothing is said.
        $calm = $this->check($home, ['sections' => [
            $this->section('s_top', [$this->el('e_top', 'illustration', ['play' => 'view']), $loop('e_l1'), $loop('e_l2'), $loop('e_l3')], self::fx()),
            $this->section('s_two', [$this->el('e_late', 'illustration', ['play' => 'loop']), $loop('e_l4'), $loop('e_l5'), $loop('e_l6')], self::fx('petals')),
        ]]);
        foreach (['BACKGROUND_FX_MANY', 'ICON_LOOP_MANY', 'ILLUSTRATION_TOP'] as $code) {
            $this->assertArrayNotHasKey($code, $calm, $code);
        }
    }

    public function test_the_theme_effects_are_optional_saved_through_the_theme_endpoints_and_reach_the_bootstrap(): void
    {
        // A store that never set them: no key in the theme, the defaults in the bootstrap.
        $this->assertArrayNotHasKey('effects', $this->getJson('/api/v1/storefront/theme')->assertOk()->json('data.settings'));
        $this->publishTheme(['colors' => ['primary' => '#123456']])->assertOk();
        $this->assertArrayNotHasKey('effects', $this->getJson('/api/v1/storefront/theme')->assertOk()->json('data.settings'));
        $this->app['auth']->forgetGuards();
        $this->getJson(self::STORE.'/bootstrap')->assertOk()->assertJsonPath('data.theme.effects', ['add_to_cart' => 'bump', 'button_feedback' => true]);

        $this->actingAsUser($this->t['admin']);
        $this->publishTheme(['effects' => ['add_to_cart' => 'fly', 'button_feedback' => false]])->assertOk()
            ->assertJsonPath('data.settings.effects', ['add_to_cart' => 'fly', 'button_feedback' => false]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.theme_updated']);
        // Missing keys take their defaults.
        $this->publishTheme(['effects' => ['add_to_cart' => 'none']])->assertOk()
            ->assertJsonPath('data.settings.effects', ['add_to_cart' => 'none', 'button_feedback' => true]);
        // The theme draft takes them too.
        $revision = $this->getJson('/api/v1/storefront/theme/draft')->assertOk()->json('data.draft_revision');
        $this->putJson('/api/v1/storefront/theme/draft', ['revision' => $revision, 'settings' => ['effects' => ['add_to_cart' => 'fly', 'button_feedback' => true]]])->assertOk();
        $this->getJson('/api/v1/storefront/theme/draft')->assertOk()->assertJsonPath('data.settings.effects.add_to_cart', 'fly');
        $this->postJson('/api/v1/storefront/theme/publish')->assertOk();

        // Invalid values are refused with their keys.
        $this->publishTheme(['effects' => ['add_to_cart' => 'explode', 'button_feedback' => 'maybe']])->assertStatus(422)
            ->assertJsonValidationErrorFor('settings.effects.add_to_cart', 'error.details')
            ->assertJsonValidationErrorFor('settings.effects.button_feedback', 'error.details');
        $this->publishTheme(['effects' => 'fly'])->assertStatus(422)->assertJsonValidationErrorFor('settings.effects', 'error.details');

        // A preset keeps them; the shopper store gets them.
        $this->postJson('/api/v1/storefront/theme/presets/vegan/apply')->assertOk()
            ->assertJsonPath('data.settings.preset', 'vegan')
            ->assertJsonPath('data.settings.effects', ['add_to_cart' => 'fly', 'button_feedback' => true]);

        // Another store is not affected.
        $other = $this->openStore('Mango Mart', 'mango.test');
        $this->app['auth']->forgetGuards();
        $this->getJson(self::STORE.'/bootstrap')->assertOk()->assertJsonPath('data.theme.effects', ['add_to_cart' => 'fly', 'button_feedback' => true]);
        $this->getJson('http://mango.test/api/v1/store/bootstrap')->assertOk()->assertJsonPath('data.theme.effects', ['add_to_cart' => 'bump', 'button_feedback' => true]);
        $this->actingAsUser($other['admin']);
        $this->assertArrayNotHasKey('effects', $this->getJson('/api/v1/storefront/theme')->assertOk()->json('data.settings'));

        // Unset again with null.
        $this->actingAsUser($this->t['admin']);
        $this->publishTheme(['effects' => null])->assertOk();
        $this->assertArrayNotHasKey('effects', $this->getJson('/api/v1/storefront/theme')->assertOk()->json('data.settings'));
    }
}
