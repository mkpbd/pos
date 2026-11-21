<?php

namespace App\Modules\Storefront\Tests\Unit;

use App\Modules\Storefront\Application\Builder\BuilderPageRenderer;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use App\Modules\Storefront\Domain\Builder\StyleSchema;
use Tests\TestCase;

/**
 * B18 (motion studio): the motion easing and the new entrances / loops / hover effects, text
 * effects on headings, texts and calls to action (rotating words translated by index), card hover
 * on product listing elements, animated section dividers and two new shapes, the document's
 * `motion_theme` — all optional and kept only when set — and the registry's enums and limits.
 */
class BuilderB18SchemaTest extends TestCase
{
    private const UUID = '0199a5c1-0000-7000-8000-00000000aa01';

    /**
     * @param  list<array<string, mixed>>  $elements
     * @param  array<string, mixed>  $extra  section keys
     * @return array<string, mixed>
     */
    private function doc(array $elements, array $extra = []): array
    {
        return ['schema_version' => 1, 'sections' => [$extra + [
            'id' => 's_one', 'type' => 'section',
            'columns' => [['id' => 'c_one', 'width' => ['base' => 100], 'elements' => $elements]],
        ]]];
    }

    /**
     * @param  array<string, mixed>  $props
     * @param  array<string, mixed>  $extra
     * @return array<string, mixed>
     */
    private function el(string $id, string $type, array $props, array $extra = []): array
    {
        return $extra + ['id' => $id, 'type' => $type, 'props' => $props];
    }

    /**
     * @return array<string, mixed>
     */
    private function first(array $document, string $context = 'page'): array
    {
        return BuilderDocumentSchema::normalize($document, $context)['sections'][0]['columns'][0]['elements'][0];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function errors(array $document, string $context = 'page'): array
    {
        try {
            BuilderDocumentSchema::normalize($document, $context);
        } catch (InvalidBuilderDocument $e) {
            return $e->errors;
        }
        $this->fail('The document was accepted.');
    }

    public function test_documents_without_b18_keys_normalize_exactly_as_before(): void
    {
        $doc = $this->doc([
            $this->el('e_head', 'heading', ['text' => 'Hello', 'level' => 2], ['style' => ['base' => ['motion' => ['entrance' => 'fade', 'loop' => 'pulse'], 'hover' => ['effect' => 'lift']]]]),
            $this->el('e_grid', 'product_grid', ElementRegistry::defaults('product_grid')),
        ], ['props' => ['shape_top' => ['shape' => 'wave', 'color' => 'theme:primary', 'height' => 40, 'flip' => false]]]);
        $normalized = BuilderDocumentSchema::normalize($doc);

        $this->assertArrayNotHasKey('motion_theme', $normalized);
        $this->assertSame(['shape' => 'wave', 'color' => 'theme:primary', 'height' => 40, 'flip' => false], $normalized['sections'][0]['props']['shape_top']);
        $heading = $normalized['sections'][0]['columns'][0]['elements'][0];
        $this->assertSame(['text' => 'Hello', 'level' => 2, 'link' => null], $heading['props']);
        $this->assertSame(['motion' => ['entrance' => 'fade', 'loop' => 'pulse'], 'hover' => ['effect' => 'lift']], $heading['style']['base']);
        $this->assertSame(['title', 'subtitle', 'config', 'items'], array_keys($normalized['sections'][0]['columns'][0]['elements'][1]['props']));
        $this->assertSame($normalized, BuilderDocumentSchema::normalize($normalized));
    }

    public function test_motion_gains_easing_entrances_and_loops_and_hover_gains_effects(): void
    {
        foreach (['mask-up', 'mask-left', 'drop-in', 'swing', 'scale-down'] as $entrance) {
            $this->assertContains($entrance, StyleSchema::MOTION_ENTRANCES);
        }
        foreach (StyleSchema::MOTION_EASINGS as $easing) {
            $style = StyleSchema::normalize(['base' => ['motion' => ['entrance' => 'mask-up', 'easing' => $easing, 'duration' => 600]]]);
            $this->assertSame(['entrance' => 'mask-up', 'duration' => 600, 'easing' => $easing], $style['base']['motion']);
        }
        // Easing is kept with a loop only (no entrance), unknown values dropped silently.
        $this->assertSame(['entrance' => 'none', 'easing' => 'spring', 'loop' => 'heartbeat', 'loop_forever' => true], StyleSchema::normalize(['base' => ['motion' => [
            'entrance' => 'none', 'easing' => 'spring', 'loop' => 'heartbeat', 'loop_forever' => true,
        ]]])['base']['motion']);
        $this->assertSame(['entrance' => 'fade'], StyleSchema::normalize(['base' => ['motion' => ['entrance' => 'fade', 'easing' => 'elastic', 'loop' => 'explode']]])['base']['motion']);
        $this->assertSame([], StyleSchema::normalize(['base' => ['motion' => ['entrance' => 'teleport', 'easing' => 'smooth']]]));
        foreach (['wiggle', 'heartbeat', 'breathe', 'shine', 'spin-slow'] as $loop) {
            $this->assertSame($loop, StyleSchema::normalize(['base' => ['motion' => ['entrance' => 'none', 'loop' => $loop]]])['base']['motion']['loop']);
        }
        foreach (['tilt-3d', 'zoom-image', 'glare', 'pop', 'lift-shadow', 'shine'] as $effect) {
            $this->assertSame(['effect' => $effect, 'duration' => 300], StyleSchema::normalize(['base' => ['hover' => ['effect' => $effect, 'duration' => 300]]])['base']['hover']);
        }
        $this->assertSame([], StyleSchema::normalize(['base' => ['hover' => ['effect' => 'tilt_3d']]]));
        // Motion stays a base-only group.
        $this->assertSame([], StyleSchema::normalize(['mobile' => ['motion' => ['entrance' => 'swing', 'easing' => 'bounce']]]));
    }

    public function test_text_effects_on_headings_texts_and_calls_to_action(): void
    {
        $heading = $this->first($this->doc([$this->el('e_h', 'heading', ['text' => 'Fresh food', 'text_effect' => [
            'type' => 'rotate_words', 'words' => ['fast', 'fresh', 'ফ্রেশ'], 'speed' => 'fast', 'color_role' => 'accent', 'cycles' => null, 'extra' => 1,
        ]])]));
        $this->assertSame(['type' => 'rotate_words', 'words' => ['fast', 'fresh', 'ফ্রেশ'], 'speed' => 'fast', 'color_role' => 'accent', 'cycles' => null], $heading['props']['text_effect']);

        // Absent cycles stay absent (storefront default); words, cycles dropped where they don't apply.
        $text = $this->first($this->doc([$this->el('e_t', 'text', ['html' => '<p>Hi there</p>', 'text_effect' => ['type' => 'typewriter']])]));
        $this->assertSame(['type' => 'typewriter'], $text['props']['text_effect']);
        $typed = $this->first($this->doc([$this->el('e_t', 'text', ['html' => '<p>Hi</p>', 'text_effect' => ['type' => 'typewriter', 'cycles' => 3, 'words' => ['x']]])]));
        $this->assertSame(['type' => 'typewriter', 'cycles' => 3], $typed['props']['text_effect']);
        $cta = $this->first($this->doc([$this->el('e_c', 'cta', ['title' => 'Eid sale', 'text_effect' => ['type' => 'highlight_draw', 'color_role' => 'primary', 'cycles' => 2, 'words' => ['a']]])]));
        $this->assertSame(['type' => 'highlight_draw', 'color_role' => 'primary'], $cta['props']['text_effect']);

        // None and null drop the prop; other elements never keep it.
        foreach ([['type' => 'none', 'speed' => 'fast'], null] as $none) {
            $this->assertArrayNotHasKey('text_effect', $this->first($this->doc([$this->el('e_h', 'heading', ['text' => 'Hi', 'text_effect' => $none])]))['props']);
        }
        $this->assertArrayNotHasKey('text_effect', $this->first($this->doc([$this->el('e_b', 'button', ['label' => 'Go', 'text_effect' => ['type' => 'typewriter']])]))['props']);

        $once = BuilderDocumentSchema::normalize($this->doc([$this->el('e_h', 'heading', ['text' => 'Hi', 'text_effect' => ['type' => 'rotate_words', 'words' => ['a', 'b'], 'cycles' => 5]])]));
        $this->assertSame($once, BuilderDocumentSchema::normalize($once));
    }

    public function test_invalid_text_effects_are_refused_with_their_paths(): void
    {
        $cases = [
            [['type' => 'sparkle'], 'type'],
            ['typewriter', ''],
            [['type' => 'rotate_words'], 'words'],
            [['type' => 'rotate_words', 'words' => []], 'words'],
            [['type' => 'rotate_words', 'words' => ['1', '2', '3', '4', '5', '6', '7']], 'words'],
            [['type' => 'rotate_words', 'words' => ['ok', '  ']], 'words.1'],
            [['type' => 'rotate_words', 'words' => [str_repeat('a', 41)]], 'words.0'],
            [['type' => 'rotate_words', 'words' => ['ok', 7]], 'words.1'],
            [['type' => 'reveal_words', 'speed' => 'turbo'], 'speed'],
            [['type' => 'gradient_shimmer', 'color_role' => 'danger'], 'color_role'],
            [['type' => 'typewriter', 'cycles' => 0], 'cycles'],
            [['type' => 'rotate_words', 'words' => ['a'], 'cycles' => 6], 'cycles'],
            [['type' => 'typewriter', 'cycles' => '2'], 'cycles'],
        ];
        foreach ($cases as [$effect, $key]) {
            $errors = $this->errors($this->doc([$this->el('e_h', 'heading', ['text' => 'Hi', 'text_effect' => $effect])]));
            $path = 'sections.0.columns.0.elements.0.props.text_effect'.($key === '' ? '' : ".{$key}");
            $this->assertSame([$path], array_column($errors, 'path'), json_encode($effect));
            $this->assertSame('e_h', $errors[0]['node_id']);
        }
        // Exactly 40 characters and six words are fine.
        $this->first($this->doc([$this->el('e_h', 'heading', ['text' => 'Hi', 'text_effect' => ['type' => 'rotate_words', 'words' => [str_repeat('ক', 40), '2', '3', '4', '5', '6']]])]));
    }

    public function test_reveal_letters_only_for_short_texts_in_every_language(): void
    {
        $effect = ['type' => 'reveal_letters'];
        // 80 characters (tags and entities don't count) are fine.
        $this->first($this->doc([$this->el('e_h', 'heading', ['text' => str_repeat('a', 80), 'text_effect' => $effect])]));
        $this->first($this->doc([$this->el('e_t', 'text', ['html' => '<p><strong>'.str_repeat('b', 75).'</strong> &amp; x</p>', 'text_effect' => $effect])]));

        $errors = $this->errors($this->doc([$this->el('e_h', 'heading', ['text' => str_repeat('a', 81), 'text_effect' => $effect])]));
        $this->assertSame([['path' => 'sections.0.columns.0.elements.0.props.text_effect.type', 'code' => 'TEXT_EFFECT_TOO_LONG']], array_map(fn ($e) => ['path' => $e['path'], 'code' => $e['code']], $errors));
        $errors = $this->errors($this->doc([$this->el('e_c', 'cta', ['title' => 'Short', 'text_effect' => $effect], ['translations' => ['bn' => ['title' => str_repeat('ক', 81)]]])]));
        $this->assertSame(['sections.0.columns.0.elements.0.translations.bn.title', 'TEXT_EFFECT_TOO_LONG'], [$errors[0]['path'], $errors[0]['code']]);
        $errors = $this->errors($this->doc([$this->el('e_t', 'text', ['html' => '<p>'.str_repeat('x', 81).'</p>', 'text_effect' => $effect])]));
        $this->assertSame('TEXT_EFFECT_TOO_LONG', $errors[0]['code']);
        // Other effects take long texts.
        $this->first($this->doc([$this->el('e_h', 'heading', ['text' => str_repeat('a', 200), 'text_effect' => ['type' => 'reveal_words']])]));
    }

    public function test_rotating_words_are_translated_by_index(): void
    {
        $element = $this->first($this->doc([$this->el('e_h', 'heading', ['text' => 'We are', 'text_effect' => ['type' => 'rotate_words', 'words' => ['fast', 'fresh']]], ['translations' => ['bn' => [
            'text' => 'আমরা', 'text_effect.words.0' => 'দ্রুত', 'text_effect.words.1' => 'তাজা', 'text_effect.words.2' => 'dropped', 'text_effect.words.x' => 'dropped',
        ]]])]));
        $this->assertSame(['bn' => ['text' => 'আমরা', 'text_effect.words.0' => 'দ্রুত', 'text_effect.words.1' => 'তাজা']], $element['translations']);
        $this->assertSame(['text' => 200, 'text_effect.words.0' => 40, 'text_effect.words.1' => 40], ElementRegistry::translationFields('heading', $element['props']));
        $this->assertSame(['text_effect', 'words', 1], ElementRegistry::translationTarget('heading', 'text_effect.words.1', $element['props']));
        $this->assertNull(ElementRegistry::translationTarget('heading', 'text_effect.words.2', $element['props']));
        $this->assertContains('text_effect.words.*', ElementRegistry::translatablePatterns('cta'));
        $this->assertNotContains('text_effect.words.*', ElementRegistry::translatablePatterns('button'));

        $bn = BuilderPageRenderer::localizedProps('heading', $element['props'], $element['translations'], 'bn');
        $this->assertSame(['দ্রুত', 'তাজা'], $bn['text_effect']['words']);
        $this->assertSame('আমরা', $bn['text']);
        $partial = BuilderPageRenderer::localizedProps('heading', $element['props'], ['bn' => ['text_effect.words.1' => 'তাজা']], 'bn');
        $this->assertSame(['fast', 'তাজা'], $partial['text_effect']['words']);

        // A translated word over 40 characters is refused like any translation.
        $errors = $this->errors($this->doc([$this->el('e_h', 'heading', ['text' => 'Hi', 'text_effect' => ['type' => 'rotate_words', 'words' => ['a']]], ['translations' => ['bn' => ['text_effect.words.0' => str_repeat('ক', 41)]]])]));
        $this->assertSame('sections.0.columns.0.elements.0.translations.bn.text_effect.words.0', $errors[0]['path']);
    }

    public function test_card_hover_on_product_listing_elements(): void
    {
        $listings = [
            'product_grid' => ElementRegistry::defaults('product_grid'),
            'product_carousel' => ElementRegistry::defaults('product_carousel'),
            'product_tabs' => ['config' => ['tabs' => [['label' => 'New', 'source' => 'new_arrivals'], ['label' => 'Sale', 'source' => 'on_sale']]]],
            'product_listing' => [],
        ];
        foreach ($listings as $type => $props) {
            foreach (['lift', 'zoom_image', 'tilt_3d', 'glare', 'second_image'] as $effect) {
                $element = $this->first($this->doc([$this->el('e_l', $type, $props + ['card_hover' => $effect])]));
                $this->assertSame($effect, $element['props']['card_hover'], "{$type} {$effect}");
            }
            $this->assertArrayNotHasKey('card_hover', $this->first($this->doc([$this->el('e_l', $type, $props + ['card_hover' => 'none'])]))['props']);
            $this->assertArrayNotHasKey('card_hover', $this->first($this->doc([$this->el('e_l', $type, $props)]))['props']);
        }
        $card = $this->first($this->doc([$this->el('e_c', 'category_card', ['category_id' => self::UUID, 'card_hover' => 'zoom_image'])]));
        $this->assertSame('zoom_image', $card['props']['card_hover']);
        $spot = $this->first($this->doc([$this->el('e_s', 'product_spotlight', ['product_id' => self::UUID, 'card_hover' => 'tilt_3d'])]));
        $this->assertSame('tilt_3d', $spot['props']['card_hover']);

        // Only product cards have a second picture; unknown effects are refused; other elements drop the key.
        $errors = $this->errors($this->doc([$this->el('e_c', 'category_card', ['category_id' => self::UUID, 'card_hover' => 'second_image'])]));
        $this->assertSame(['sections.0.columns.0.elements.0.props.card_hover'], array_column($errors, 'path'));
        $errors = $this->errors($this->doc([$this->el('e_g', 'product_grid', ElementRegistry::defaults('product_grid') + ['card_hover' => 'spin'])]));
        $this->assertSame(['sections.0.columns.0.elements.0.props.card_hover'], array_column($errors, 'path'));
        $this->assertArrayNotHasKey('card_hover', $this->first($this->doc([$this->el('e_i', 'image', ['card_hover' => 'lift'])]))['props']);
        $this->assertSame(ElementRegistry::CARD_HOVER_ELEMENTS, array_values(array_filter(ElementRegistry::CARD_HOVER_ELEMENTS, fn (string $t) => ElementRegistry::exists($t))));
    }

    public function test_animated_dividers_and_new_shapes(): void
    {
        $shape = ['shape' => 'layered_waves', 'color' => '#AABBCC', 'height' => 80, 'flip' => true, 'animate' => 'flow'];
        $section = BuilderDocumentSchema::normalize($this->doc([], ['props' => ['shape_top' => $shape, 'shape_bottom' => ['shape' => 'blob', 'color' => 'theme:accent', 'animate' => 'none']]]))['sections'][0];
        $this->assertSame(['shape' => 'layered_waves', 'color' => '#aabbcc', 'height' => 80, 'flip' => true, 'animate' => 'flow'], $section['props']['shape_top']);
        $this->assertSame(['shape' => 'blob', 'color' => 'theme:accent', 'height' => 64, 'flip' => false], $section['props']['shape_bottom']);
        foreach (['drift', 'pulse'] as $animate) {
            $this->assertSame($animate, BuilderDocumentSchema::normalize($this->doc([], ['props' => ['shape_top' => ['shape' => 'wave', 'color' => '#000000', 'animate' => $animate]]]))['sections'][0]['props']['shape_top']['animate']);
        }
        $errors = $this->errors($this->doc([], ['props' => ['shape_bottom' => ['shape' => 'star', 'color' => '#000000', 'animate' => 'spin']]]));
        $this->assertSame(['sections.0.props.shape_bottom.shape', 'sections.0.props.shape_bottom.animate'], array_column($errors, 'path'));
    }

    public function test_the_motion_theme_marker_in_every_context(): void
    {
        $base = ['schema_version' => 1, 'sections' => []];
        foreach (['page', 'cms', 'zone', 'header', 'footer', 'template:shop'] as $context) {
            foreach (BuilderDocumentSchema::MOTION_THEMES as $theme) {
                $this->assertSame($theme, BuilderDocumentSchema::normalize($base + ['motion_theme' => $theme], $context)['motion_theme'], $context);
            }
        }
        $popup = BuilderDocumentSchema::normalize(BuilderDocumentSchema::blankPopup() + ['motion_theme' => 'festive'], 'popup');
        $this->assertSame(['schema_version', 'popup', 'sections', 'motion_theme'], array_keys($popup));
        $global = BuilderDocumentSchema::normalize(BuilderDocumentSchema::blankGlobal('s_g', 'c_g') + ['motion_theme' => 'calm'], 'page', true);
        $this->assertSame('calm', $global['motion_theme']);
        // Last, after the device order and A/B tests; null drops it; unknown is refused.
        $two = ['schema_version' => 1, 'sections' => [...$this->doc([])['sections'], ['id' => 's_two', 'type' => 'section', 'columns' => [['id' => 'c_two', 'width' => ['base' => 100]]]]]];
        $this->assertSame(['schema_version', 'sections', 'device_order', 'motion_theme'], array_keys(BuilderDocumentSchema::normalize($two + [
            'device_order' => ['mobile' => ['root' => ['s_two', 's_one']]], 'motion_theme' => 'premium',
        ])));
        $this->assertArrayNotHasKey('motion_theme', BuilderDocumentSchema::normalize($base + ['motion_theme' => null]));
        $this->assertSame([['path' => 'motion_theme', 'node_id' => null, 'message' => 'Choose one of: calm, lively, festive, premium, minimal.']], $this->errors($base + ['motion_theme' => 'wild']));
    }

    public function test_the_registry_exposes_the_motion_enums_and_limits(): void
    {
        $meta = ElementRegistry::metadata();
        $this->assertSame(StyleSchema::MOTION_ENTRANCES, $meta['enums']['motion_entrances']);
        $this->assertSame(['smooth', 'snappy', 'gentle', 'spring', 'bounce', 'linear'], $meta['enums']['motion_easings']);
        $this->assertSame(['none', 'pulse', 'float', 'shake', 'glow', 'wiggle', 'heartbeat', 'breathe', 'shine', 'spin-slow'], $meta['enums']['motion_loops']);
        $this->assertSame(['once', 'every_time'], $meta['enums']['motion_repeats']);
        $this->assertSame(StyleSchema::HOVER_EFFECTS, $meta['enums']['hover_effects']);
        $this->assertSame(['none', 'slow', 'medium'], $meta['enums']['parallax']);
        $this->assertSame(['wave', 'curve', 'tilt', 'triangle', 'zigzag', 'layered_waves', 'blob'], $meta['enums']['section_shapes']);
        $this->assertSame(['none', 'flow', 'drift', 'pulse'], $meta['enums']['shape_animations']);
        $this->assertSame(ElementRegistry::TEXT_EFFECT_TYPES, $meta['enums']['text_effect_types']);
        $this->assertSame(['slow', 'normal', 'fast'], $meta['enums']['text_effect_speeds']);
        $this->assertSame(['primary', 'accent', 'secondary'], $meta['enums']['text_effect_color_roles']);
        $this->assertSame(['heading', 'text', 'cta'], $meta['enums']['text_effect_elements']);
        $this->assertSame(['none', 'lift', 'zoom_image', 'tilt_3d', 'glare', 'second_image'], $meta['enums']['card_hover_effects']);
        $this->assertSame(ElementRegistry::CARD_HOVER_ELEMENTS, $meta['enums']['card_hover_elements']);
        $this->assertSame(['product_grid', 'product_carousel', 'product_tabs', 'product_listing'], $meta['enums']['card_hover_second_image_elements']);
        $this->assertSame(['calm', 'lively', 'festive', 'premium', 'minimal'], $meta['enums']['motion_themes']);
        $this->assertSame([
            'words' => ['min' => 1, 'max' => 6], 'word_max' => 40, 'reveal_letters_max' => 80, 'cycles' => ['min' => 1, 'max' => 5],
        ], $meta['limits']['text_effect']);
        $this->assertSame(['min' => 0, 'max' => 500], $meta['limits']['motion_stagger']);
        $this->assertSame(['min' => 100, 'max' => 600], $meta['limits']['hover_duration']);
        $heading = array_values(array_filter($meta['types'], fn (array $t) => $t['type'] === 'heading'))[0];
        $this->assertSame(['text', 'text_effect.words.*'], $heading['translatable']);
    }
}
