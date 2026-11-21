<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * B18 (motion studio): the new motion keys survive save, publish and the published payload (the
 * rotating words in Bangla), invalid ones are refused on save, the registry endpoint exposes the
 * enums, and the page check warns about late top content (MOTION_LCP), too much looping
 * (MOTION_TOO_MUCH) and text effects on long texts (TEXT_EFFECT_LONG). PostgreSQL.
 */
class StoreBuilderB18Test extends TestCase
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
        $this->t = $this->openStore('Berry Kids', 'berry.test');
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
    private static function motion(string $entrance = 'none', ?string $loop = null, bool $forever = false): array
    {
        return ['style' => ['base' => ['motion' => array_filter(['entrance' => $entrance, 'loop' => $loop, 'loop_forever' => $forever ?: null], fn ($v) => $v !== null)]]];
    }

    private function save(string $id, array $content): TestResponse
    {
        $revision = $this->getJson(self::DOCS."/{$id}")->assertOk()->json('data.draft_revision');

        return $this->putJson(self::DOCS."/{$id}/draft", ['revision' => $revision, 'content' => ['schema_version' => 1] + $content]);
    }

    /**
     * @return array<string, list<array<string, mixed>>>
     */
    private function check(string $id, ?array $content = null): array
    {
        $issues = $this->postJson(self::DOCS."/{$id}/check", $content === null ? [] : ['content' => ['schema_version' => 1] + $content])->assertOk()->json('data.issues');
        $codes = [];
        foreach ($issues as $issue) {
            $codes[$issue['code']][] = $issue;
        }

        return $codes;
    }

    public function test_motion_keys_survive_save_and_publish_and_rotating_words_are_translated(): void
    {
        $home = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home'])->assertCreated()->json('data.id');
        $content = ['motion_theme' => 'festive', 'sections' => [
            $this->section('s_top', [
                $this->el('e_head', 'heading', ['text' => 'We are', 'text_effect' => ['type' => 'rotate_words', 'words' => ['fast', 'fresh'], 'speed' => 'slow', 'cycles' => 3]], [
                    'translations' => ['bn' => ['text' => 'আমরা', 'text_effect.words.0' => 'দ্রুত', 'text_effect.words.1' => 'তাজা']],
                ]),
                $this->el('e_grid', 'product_grid', ['config' => ['source' => 'featured'], 'card_hover' => 'second_image']),
                $this->el('e_btn', 'button', ['label' => 'Shop'], ['style' => ['base' => [
                    'motion' => ['entrance' => 'drop-in', 'easing' => 'spring', 'loop' => 'shine'],
                    'hover' => ['effect' => 'lift-shadow'],
                ]]]),
            ], ['props' => ['shape_bottom' => ['shape' => 'layered_waves', 'color' => 'theme:primary', 'animate' => 'flow']]]),
        ]];
        $draft = $this->save($home, $content)->assertOk()->json('data.content');
        $this->assertSame('festive', $draft['motion_theme']);
        $this->assertSame('flow', $draft['sections'][0]['props']['shape_bottom']['animate']);
        $elements = $draft['sections'][0]['columns'][0]['elements'];
        // (jsonb storage orders keys its own way.)
        $this->assertEquals(['type' => 'rotate_words', 'words' => ['fast', 'fresh'], 'speed' => 'slow', 'cycles' => 3], $elements[0]['props']['text_effect']);
        $this->assertSame('second_image', $elements[1]['props']['card_hover']);
        $this->assertEquals(['entrance' => 'drop-in', 'easing' => 'spring', 'loop' => 'shine'], $elements[2]['style']['base']['motion']);
        $this->assertSame(['effect' => 'lift-shadow'], $elements[2]['style']['base']['hover']);
        // Saving what came back changes nothing.
        $again = $this->save($home, $draft)->assertOk()->json('data.content');
        $this->assertEquals($draft, $again);

        // Publishing validates as before and the keys reach shoppers (words in Bangla with ?lang=bn).
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();
        $this->app['auth']->forgetGuards();
        $page = $this->getJson(self::STORE.'/builder/pages/home')->assertOk()->json('data');
        $heading = $page['sections'][0]['columns'][0]['elements'][0];
        $this->assertSame(['fast', 'fresh'], $heading['props']['text_effect']['words']);
        $this->assertSame('flow', $page['sections'][0]['props']['shape_bottom']['animate']);
        $bn = $this->getJson(self::STORE.'/builder/pages/home?lang=bn')->assertOk()->json('data');
        $this->assertSame(['দ্রুত', 'তাজা'], $bn['sections'][0]['columns'][0]['elements'][0]['props']['text_effect']['words']);
        $this->assertSame('আমরা', $bn['sections'][0]['columns'][0]['elements'][0]['props']['text']);
    }

    public function test_invalid_motion_keys_are_refused_on_save_and_the_registry_lists_the_enums(): void
    {
        $home = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home'])->assertCreated()->json('data.id');
        $response = $this->save($home, ['motion_theme' => 'disco', 'sections' => [$this->section('s_a', [
            $this->el('e_h', 'heading', ['text' => str_repeat('a', 90), 'text_effect' => ['type' => 'reveal_letters']]),
            $this->el('e_c', 'category_card', ['category_id' => '0199a5c1-0000-7000-8000-00000000aa01', 'card_hover' => 'second_image']),
        ], ['props' => ['shape_top' => ['shape' => 'blob', 'color' => '#000000', 'animate' => 'spin']]])]])->assertStatus(422);
        $response->assertJsonPath('error.code', 'DOCUMENT_INVALID');
        $errors = $response->json('error.details.errors');
        $this->assertSame([
            'sections.0.props.shape_top.animate',
            'sections.0.columns.0.elements.0.props.text_effect.type',
            'sections.0.columns.0.elements.1.props.card_hover',
            'motion_theme',
        ], array_column($errors, 'path'));
        $this->assertSame('TEXT_EFFECT_TOO_LONG', $errors[1]['code']);

        $meta = $this->getJson('/api/v1/storefront/builder/elements')->assertOk()->json('data');
        $this->assertSame(['calm', 'lively', 'festive', 'premium', 'minimal'], $meta['enums']['motion_themes']);
        $this->assertContains('spin-slow', $meta['enums']['motion_loops']);
        $this->assertContains('tilt-3d', $meta['enums']['hover_effects']);
        $this->assertSame(80, $meta['limits']['text_effect']['reveal_letters_max']);
    }

    public function test_page_check_warns_about_late_top_content(): void
    {
        $home = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home'])->assertCreated()->json('data.id');
        $this->save($home, ['sections' => [
            // A hidden first section does not count; the first shown one is checked.
            $this->section('s_hidden', [$this->el('e_hid', 'heading', ['text' => 'Hidden'], self::motion('fade'))], ['hidden' => true]),
            $this->section('s_top', [
                $this->el('e_text', 'text', ['html' => '<p>Intro</p>'], self::motion('fade')),
                $this->el('e_row', 'inner_row', [], ['columns' => [['id' => 'c_in', 'width' => ['base' => 100], 'elements' => [
                    $this->el('e_img', 'image', [], self::motion('mask-up')),
                    $this->el('e_img2', 'image', [], self::motion('fade')),
                ]]]]),
                $this->el('e_head', 'heading', ['text' => 'Welcome'], self::motion('slide-up')),
                $this->el('e_head2', 'heading', ['text' => 'Second'], self::motion('slide-up')),
            ], self::motion('fade')),
            $this->section('s_next', [$this->el('e_low', 'image', [], self::motion('zoom'))]),
        ]])->assertOk();

        $lcp = $this->check($home)['MOTION_LCP'];
        $this->assertSame(['s_top', 'e_img', 'e_head'], array_column($lcp, 'node_id'));
        $this->assertSame(['warning'], array_values(array_unique(array_column($lcp, 'severity'))));
        $this->assertSame('Your top picture appears late; remove its animation for a faster store.', $lcp[1]['message']);
        $this->assertSame([
            'path' => 'sections.1.columns.0.elements.1.columns.0.elements.0.style.base.motion.entrance',
            'field' => 'style.base.motion.entrance',
            'kind' => 'image',
            'entrance' => 'mask-up',
            'fix' => 'remove_entrance',
        ], $lcp[1]['details']);

        // Without the entrances (loops are fine): nothing to warn about. A global section first: not checked.
        $calm = ['sections' => [$this->section('s_top', [$this->el('e_img', 'image', [], self::motion('none', 'float')), $this->el('e_head', 'heading', ['text' => 'Hi'])])]];
        $this->assertArrayNotHasKey('MOTION_LCP', $this->check($home, $calm));
        $global = $this->postJson(self::DOCS, ['kind' => 'global', 'title' => 'Strip', 'context' => 'page'])->assertCreated()->json('data.id');
        $this->assertArrayNotHasKey('MOTION_LCP', $this->check($home, ['sections' => [
            ['id' => 'g_strip', 'type' => 'global_section', 'ref' => $global],
            $this->section('s_top', [$this->el('e_img', 'image', [], self::motion('fade'))]),
        ]]));

        // The footer's first section is not the top of the page; the header's is.
        $footer = $this->postJson(self::DOCS, ['kind' => 'footer', 'key' => 'footer', 'title' => 'Footer'])->assertCreated()->json('data.id');
        $late = ['sections' => [$this->section('s_f', [$this->el('e_h', 'heading', ['text' => 'Hi'], self::motion('fade'))])]];
        $this->assertArrayNotHasKey('MOTION_LCP', $this->check($footer, $late));
        $header = $this->postJson(self::DOCS, ['kind' => 'header', 'key' => 'header', 'title' => 'Header'])->assertCreated()->json('data.id');
        $this->assertSame(['e_h'], array_column($this->check($header, $late)['MOTION_LCP'], 'node_id'));
    }

    public function test_page_check_warns_about_too_much_looping_and_long_text_effects(): void
    {
        $home = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home'])->assertCreated()->json('data.id');
        $loops = fn (string $prefix, int $count, bool $forever = false) => array_map(
            fn (int $i) => $this->el("{$prefix}{$i}", 'button', ['label' => 'Go'], self::motion('none', 'pulse', $forever)),
            range(1, $count),
        );
        $codes = $this->check($home, ['sections' => [
            $this->section('s_busy', $loops('e_b', 7)),
            $this->section('s_ok', [...$loops('e_k', 6), $this->el('e_off', 'button', ['label' => 'Go'], self::motion('none', 'pulse') + ['hidden' => true])]),
            $this->section('s_forever', $loops('e_f', 4, true)),
            $this->section('s_text', [
                $this->el('e_rot', 'heading', ['text' => 'We are', 'text_effect' => ['type' => 'rotate_words', 'words' => ['quick', 'fresh']]], [
                    'translations' => ['bn' => ['text_effect.words.1' => str_repeat('ক', 25)]],
                ]),
                $this->el('e_rot_ok', 'heading', ['text' => 'We are', 'text_effect' => ['type' => 'rotate_words', 'words' => [str_repeat('a', 24)]]]),
                $this->el('e_type', 'text', ['html' => '<p>'.str_repeat('Long text. ', 16).'</p>', 'text_effect' => ['type' => 'typewriter']]),
                $this->el('e_type_ok', 'cta', ['title' => 'Short', 'text_effect' => ['type' => 'typewriter']]),
            ]),
        ]]);

        $tooMuch = $codes['MOTION_TOO_MUCH'];
        $this->assertSame([null, 's_busy'], array_column($tooMuch, 'node_id'));
        $this->assertSame(['ids' => ['e_f1', 'e_f2', 'e_f3', 'e_f4'], 'count' => 4, 'limit' => 3], array_diff_key($tooMuch[0]['details'], ['path' => 1, 'field' => 1]));
        $this->assertSame(7, $tooMuch[1]['details']['count']);
        $this->assertSame(6, $tooMuch[1]['details']['limit']);
        $this->assertSame('sections.0', $tooMuch[1]['details']['path']);

        $long = $codes['TEXT_EFFECT_LONG'];
        $this->assertSame(['e_rot', 'e_type'], array_column($long, 'node_id'));
        $this->assertSame(['props.text_effect.words', [1], 24], [$long[0]['details']['field'], $long[0]['details']['words'], $long[0]['details']['limit']]);
        $this->assertSame(['props.text_effect.type', 160], [$long[1]['details']['field'], $long[1]['details']['limit']]);
        $this->assertSame(['warning'], array_values(array_unique(array_column([...$tooMuch, ...$long], 'severity'))));
    }
}
