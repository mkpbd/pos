<?php

namespace App\Modules\Storefront\Tests\Unit;

use App\Modules\Storefront\Application\Builder\BuilderPageRenderer;
use App\Modules\Storefront\Application\Builder\Templates\BuilderTemplateLibrary;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use App\Modules\Storefront\Domain\Builder\StyleSchema;
use App\Modules\Storefront\Domain\Builder\Templates\PortableTemplate;
use Tests\TestCase;

/**
 * B19 (scroll stories): the `scroll` style group, a section's `background_scroll` (and how it
 * replaces the parallax), Ken Burns on pictures, the scroll_story and horizontal_gallery
 * elements (limits, translations, sources), the document's `scroll_progress` — all optional and
 * kept only when set — and the registry's enums, limits and elements.
 */
class BuilderB19SchemaTest extends TestCase
{
    private const MEDIA = '0199a5c1-0000-7000-8000-00000000bb01';

    private const MEDIA_2 = '0199a5c1-0000-7000-8000-00000000bb02';

    private const PRODUCT = '0199a5c1-0000-7000-8000-00000000cc01';

    private const PRODUCT_2 = '0199a5c1-0000-7000-8000-00000000cc02';

    /**
     * @param  list<array<string, mixed>>  $elements
     * @param  array<string, mixed>  $extra  section keys
     * @param  array<string, mixed>  $document  document keys
     * @return array<string, mixed>
     */
    private function doc(array $elements, array $extra = [], array $document = []): array
    {
        return $document + ['schema_version' => 1, 'sections' => [$extra + [
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
     * @return array<string, string> path => message
     */
    private function errors(array $document, string $context = 'page', bool $global = false): array
    {
        try {
            BuilderDocumentSchema::normalize($document, $context, $global);
        } catch (InvalidBuilderDocument $e) {
            return array_column($e->errors, 'message', 'path');
        }
        $this->fail('The document was accepted.');
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private static function step(string $id, array $overrides = []): array
    {
        return $overrides + ['id' => $id, 'media_id' => self::MEDIA, 'alt' => 'A photo', 'kicker' => 'Step', 'heading' => 'Heading '.$id, 'text' => 'Some text.', 'link' => null];
    }

    public function test_documents_without_b19_keys_normalize_exactly_as_before(): void
    {
        $background = ['type' => 'image', 'image' => ['media_id' => self::MEDIA], 'parallax' => 'slow'];
        $doc = $this->doc([
            $this->el('e_img', 'image', ['media_id' => self::MEDIA, 'alt' => 'x']),
            $this->el('e_car', 'image_carousel', ['images' => [['id' => 'g1', 'media_id' => self::MEDIA]]]),
        ], ['style' => ['base' => ['background' => $background, 'motion' => ['entrance' => 'fade']]]]);
        $normalized = BuilderDocumentSchema::normalize($doc);

        $this->assertArrayNotHasKey('scroll_progress', $normalized);
        $this->assertSame(['layout' => 'boxed', 'anchor' => null], $normalized['sections'][0]['props']);
        $this->assertSame($background, $normalized['sections'][0]['style']['base']['background']);
        $this->assertSame(['background', 'motion'], array_keys($normalized['sections'][0]['style']['base']));
        $elements = $normalized['sections'][0]['columns'][0]['elements'];
        $this->assertSame(['media_id', 'alt', 'link', 'aspect', 'fit'], array_keys($elements[0]['props']));
        $this->assertSame(['images', 'autoplay', 'show_dots', 'show_arrows', 'aspect'], array_keys($elements[1]['props']));
        $this->assertSame($normalized, BuilderDocumentSchema::normalize($normalized));
    }

    public function test_the_scroll_style_group_is_kept_at_base_on_any_node_and_invalid_values_drop(): void
    {
        foreach (StyleSchema::SCROLL_EFFECTS as $effect) {
            $style = StyleSchema::normalize(['base' => ['scroll' => ['effect' => $effect, 'intensity' => 'strong', 'range' => 'enter_exit']]]);
            $this->assertSame($effect === 'none' ? [] : ['base' => ['scroll' => ['effect' => $effect, 'intensity' => 'strong', 'range' => 'enter_exit']]], $style, $effect);
        }
        // Defaults are not filled in; invalid sub-values drop silently; an unknown effect drops the group.
        $this->assertSame(['base' => ['scroll' => ['effect' => 'rise']]], StyleSchema::normalize(['base' => ['scroll' => ['effect' => 'rise', 'intensity' => 'huge', 'range' => 'always', 'extra' => 1]]]));
        $this->assertSame([], StyleSchema::normalize(['base' => ['scroll' => ['effect' => 'spin', 'intensity' => 'subtle']]]));
        $this->assertSame([], StyleSchema::normalize(['base' => ['scroll' => 'fade']]));
        // Base only.
        $this->assertSame(['base' => ['scroll' => ['effect' => 'fade']]], StyleSchema::normalize([
            'base' => ['scroll' => ['effect' => 'fade']],
            'tablet' => ['scroll' => ['effect' => 'rise']],
            'mobile' => ['scroll' => ['effect' => 'blur']],
        ]));

        // Sections, columns and elements keep it.
        $scroll = ['style' => ['base' => ['scroll' => ['effect' => 'reveal_circle', 'range' => 'cover']]]];
        $doc = ['schema_version' => 1, 'sections' => [$scroll + [
            'id' => 's_one', 'type' => 'section',
            'columns' => [$scroll + ['id' => 'c_one', 'width' => ['base' => 100], 'elements' => [$this->el('e_h', 'heading', ['text' => 'Hi'], $scroll)]]],
        ]]];
        $section = BuilderDocumentSchema::normalize($doc)['sections'][0];
        foreach ([$section, $section['columns'][0], $section['columns'][0]['elements'][0]] as $node) {
            $this->assertSame(['effect' => 'reveal_circle', 'range' => 'cover'], $node['style']['base']['scroll']);
        }
    }

    public function test_background_scroll_needs_a_background_image_and_replaces_the_parallax(): void
    {
        $image = ['type' => 'image', 'image' => ['media_id' => self::MEDIA], 'parallax' => 'medium'];
        foreach (['zoom_in', 'zoom_out', 'pan_up', 'pan_down'] as $move) {
            $section = BuilderDocumentSchema::normalize($this->doc([], ['props' => ['background_scroll' => $move], 'style' => ['base' => ['background' => $image]]]))['sections'][0];
            $this->assertSame(['layout' => 'boxed', 'anchor' => null, 'background_scroll' => $move], $section['props']);
            // The parallax gives way.
            $this->assertSame(['type' => 'image', 'image' => ['media_id' => self::MEDIA]], $section['style']['base']['background']);
            $this->assertSame($section, BuilderDocumentSchema::normalize(['schema_version' => 1, 'sections' => [$section]])['sections'][0]);
        }
        // Without a background image (none, a colour, an image set only for phones) it is dropped
        // silently and the parallax stays.
        foreach ([
            null,
            ['base' => ['background' => ['type' => 'color', 'color' => '#ffffff', 'parallax' => 'slow']]],
            ['mobile' => ['background' => ['type' => 'image', 'image' => ['media_id' => self::MEDIA]]]],
            ['base' => ['background' => ['type' => 'none', 'image' => ['media_id' => self::MEDIA]]]],
        ] as $style) {
            $section = BuilderDocumentSchema::normalize($this->doc([], ['props' => ['background_scroll' => 'zoom_in']] + ($style === null ? [] : ['style' => $style])))['sections'][0];
            $this->assertArrayNotHasKey('background_scroll', $section['props']);
        }
        $this->assertSame('slow', BuilderDocumentSchema::normalize($this->doc([], ['props' => ['background_scroll' => 'none'], 'style' => ['base' => ['background' => ['type' => 'image', 'image' => ['media_id' => self::MEDIA], 'parallax' => 'slow']]]]))['sections'][0]['style']['base']['background']['parallax']);
        $this->assertArrayHasKey('sections.0.props.background_scroll', $this->errors($this->doc([], ['props' => ['background_scroll' => 'spin'], 'style' => ['base' => ['background' => $image]]])));
    }

    public function test_ken_burns_on_pictures_with_an_optional_direction(): void
    {
        $image = $this->first($this->doc([$this->el('e_img', 'image', ['media_id' => self::MEDIA, 'ken_burns' => 'slow', 'ken_burns_direction' => 'in'])]));
        $this->assertSame(['media_id', 'alt', 'link', 'aspect', 'fit', 'ken_burns', 'ken_burns_direction'], array_keys($image['props']));
        $this->assertSame(['slow', 'in'], [$image['props']['ken_burns'], $image['props']['ken_burns_direction']]);

        $carousel = $this->first($this->doc([$this->el('e_car', 'image_carousel', ['images' => [['id' => 'g1', 'media_id' => self::MEDIA]], 'ken_burns' => 'normal'])]));
        $this->assertSame('normal', $carousel['props']['ken_burns']);
        $this->assertArrayNotHasKey('ken_burns_direction', $carousel['props']);

        // A hero slider keeps it at its props' top level, next to title / subtitle / config / items.
        $hero = $this->first($this->doc([$this->el('e_hero', 'hero_slider', ['items' => [['item_type' => 'banner', 'item_id' => self::MEDIA_2]], 'ken_burns' => 'slow', 'ken_burns_direction' => 'alternate'])]));
        $this->assertSame(['title', 'subtitle', 'config', 'items', 'ken_burns', 'ken_burns_direction'], array_keys($hero['props']));

        // `none` and a direction without the zoom are dropped; other elements don't take it.
        $this->assertSame(['media_id', 'alt', 'link', 'aspect', 'fit'], array_keys($this->first($this->doc([$this->el('e_img', 'image', ['ken_burns' => 'none', 'ken_burns_direction' => 'out'])]))['props']));
        $this->assertArrayNotHasKey('ken_burns', $this->first($this->doc([$this->el('e_gal', 'gallery', ['images' => [['id' => 'g1', 'media_id' => self::MEDIA]], 'ken_burns' => 'slow'])]))['props']);

        $errors = $this->errors($this->doc([
            $this->el('e_a', 'image', ['ken_burns' => 'fast']),
            $this->el('e_b', 'image', ['ken_burns' => 'slow', 'ken_burns_direction' => 'sideways']),
        ]));
        $this->assertArrayHasKey('sections.0.columns.0.elements.0.props.ken_burns', $errors);
        $this->assertArrayHasKey('sections.0.columns.0.elements.1.props.ken_burns_direction', $errors);
    }

    public function test_the_scroll_story_element(): void
    {
        // The inserted default is valid (pictures still to choose).
        $default = $this->first($this->doc([$this->el('e_story', 'scroll_story', [])]));
        $this->assertSame(ElementRegistry::defaults('scroll_story'), $default['props']);
        $this->assertSame([null, null, null], array_column($default['props']['steps'], 'media_id'));

        $props = [
            'steps' => [self::step('s1', ['media_id' => strtoupper(self::MEDIA), 'extra' => 'x']), self::step('s2', ['link' => ['label' => 'Shop', 'url' => '/shop', 'extra' => 1]])],
            'media_side' => 'right', 'media_ratio' => 'landscape', 'transition' => 'zoom', 'progress_dots' => false, 'unknown' => true,
        ];
        $story = $this->first($this->doc([$this->el('e_story', 'scroll_story', $props, ['translations' => ['bn' => [
            'steps.s1.heading' => 'শিরোনাম', 'steps.s1.alt' => 'ছবি', 'steps.s1.kicker' => 'ধাপ', 'steps.s1.text' => 'লেখা',
            'steps.s2.link.label' => 'কিনুন', 'steps.s1.link.label' => 'nothing to translate', 'steps.s9.heading' => 'gone',
        ]]])]));
        $this->assertSame(['steps', 'media_side', 'media_ratio', 'transition', 'progress_dots'], array_keys($story['props']));
        $this->assertSame(['id', 'media_id', 'alt', 'kicker', 'heading', 'text', 'link'], array_keys($story['props']['steps'][0]));
        $this->assertSame(self::MEDIA, $story['props']['steps'][0]['media_id']);
        $this->assertSame(['label' => 'Shop', 'url' => '/shop'], $story['props']['steps'][1]['link']);
        $this->assertSame(['right', 'landscape', 'zoom', false], [$story['props']['media_side'], $story['props']['media_ratio'], $story['props']['transition'], $story['props']['progress_dots']]);
        $this->assertSame(['steps.s1.alt' => 'ছবি', 'steps.s1.kicker' => 'ধাপ', 'steps.s1.heading' => 'শিরোনাম', 'steps.s1.text' => 'লেখা', 'steps.s2.link.label' => 'কিনুন'], $story['translations']['bn']);
        $this->assertSame(ElementRegistry::mediaIds('scroll_story', $story['props']), [self::MEDIA]);

        // Translated for the request's language (the link label too).
        $bn = BuilderPageRenderer::localizedProps('scroll_story', $story['props'], $story['translations'], 'bn');
        $this->assertSame(['শিরোনাম', 'Heading s2'], array_column($bn['steps'], 'heading'));
        $this->assertSame('কিনুন', $bn['steps'][1]['link']['label']);

        $errors = $this->errors($this->doc([
            $this->el('e_one', 'scroll_story', ['steps' => [self::step('s1')]]),
            $this->el('e_many', 'scroll_story', ['steps' => array_map(fn (int $i) => self::step("s{$i}"), range(1, 7))]),
            $this->el('e_bad', 'scroll_story', ['steps' => [
                self::step('s1', ['heading' => ' ', 'media_id' => 'not-an-id']),
                self::step('s2', ['text' => str_repeat('a', 601), 'kicker' => str_repeat('k', 61), 'alt' => str_repeat('a', 201)]),
                self::step('s3', ['link' => ['label' => 'Go', 'url' => 'javascript:alert(1)']]),
                self::step('s4', ['link' => ['label' => str_repeat('l', 41), 'url' => '/shop']]),
                self::step('s4'),
            ], 'media_side' => 'top', 'transition' => 'spin', 'progress_dots' => 'yes']),
        ]));
        $p = 'sections.0.columns.0.elements';
        foreach ([
            "{$p}.0.props.steps", "{$p}.1.props.steps",
            "{$p}.2.props.steps.0.heading", "{$p}.2.props.steps.0.media_id", "{$p}.2.props.steps.1.text", "{$p}.2.props.steps.1.kicker",
            "{$p}.2.props.steps.1.alt", "{$p}.2.props.steps.2.link.url", "{$p}.2.props.steps.3.link.label", "{$p}.2.props.steps.4.id",
            "{$p}.2.props.media_side", "{$p}.2.props.transition", "{$p}.2.props.progress_dots",
        ] as $path) {
            $this->assertArrayHasKey($path, $errors, $path);
        }
        // Translations within their limits.
        $this->assertArrayHasKey("{$p}.0.translations.bn.steps.s1.heading", $this->errors($this->doc([
            $this->el('e_story', 'scroll_story', ['steps' => [self::step('s1'), self::step('s2')]], ['translations' => ['bn' => ['steps.s1.heading' => str_repeat('ক', 121)]]]),
        ])));
    }

    public function test_the_horizontal_gallery_element(): void
    {
        $default = $this->first($this->doc([$this->el('e_gal', 'horizontal_gallery', [])]));
        $this->assertSame(ElementRegistry::defaults('horizontal_gallery'), $default['props']);
        $this->assertFalse(ElementRegistry::needsData('horizontal_gallery', $default['props']));

        $item = fn (string $id, array $o = []) => $o + ['id' => $id, 'media_id' => self::MEDIA, 'alt' => 'Alt', 'caption' => 'Caption', 'link' => null];
        // Pictures: the product list of the other source is emptied.
        $gallery = $this->first($this->doc([$this->el('e_gal', 'horizontal_gallery', [
            'source' => 'images', 'items' => [$item('g1'), $item('g2', ['media_id' => self::MEDIA_2, 'link' => ['url' => '/shop']]), $item('g3', ['media_id' => null])],
            'product_ids' => [self::PRODUCT], 'card_width' => 'large', 'pin' => false, 'show_progress' => false,
        ], ['translations' => ['bn' => ['items.g1.caption' => 'ক্যাপশন', 'items.g2.alt' => 'ছবি']]])]));
        $this->assertSame(['source', 'items', 'product_ids', 'card_width', 'pin', 'show_progress'], array_keys($gallery['props']));
        $this->assertSame([], $gallery['props']['product_ids']);
        $this->assertSame(['id', 'media_id', 'alt', 'caption', 'link'], array_keys($gallery['props']['items'][0]));
        $this->assertSame(['url' => '/shop'], $gallery['props']['items'][1]['link']);
        $this->assertSame([self::MEDIA, self::MEDIA_2], ElementRegistry::mediaIds('horizontal_gallery', $gallery['props']));
        $this->assertSame(['items.g1.caption' => 'ক্যাপশন', 'items.g2.alt' => 'ছবি'], $gallery['translations']['bn']);

        // Products: 2–12 unique ids (lower-cased); the pictures are emptied.
        $products = $this->first($this->doc([$this->el('e_gal', 'horizontal_gallery', ['source' => 'products', 'items' => [$item('g1'), $item('g2')], 'product_ids' => [strtoupper(self::PRODUCT), self::PRODUCT_2]])]));
        $this->assertSame([[], [self::PRODUCT, self::PRODUCT_2]], [$products['props']['items'], $products['props']['product_ids']]);
        $this->assertTrue(ElementRegistry::needsData('horizontal_gallery', $products['props']));
        $this->assertSame([], ElementRegistry::mediaIds('horizontal_gallery', $products['props']));

        $errors = $this->errors($this->doc([
            $this->el('e_a', 'horizontal_gallery', ['items' => [$item('g1')]]),
            $this->el('e_b', 'horizontal_gallery', ['items' => array_map(fn (int $i) => $item("g{$i}"), range(1, 13))]),
            $this->el('e_c', 'horizontal_gallery', ['source' => 'products', 'product_ids' => [self::PRODUCT]]),
            $this->el('e_d', 'horizontal_gallery', ['source' => 'products', 'product_ids' => [self::PRODUCT, self::PRODUCT, 'nope']]),
            $this->el('e_e', 'horizontal_gallery', ['source' => 'videos', 'card_width' => 'huge', 'pin' => 1, 'items' => [$item('g1', ['caption' => str_repeat('c', 121)]), $item('g2', ['link' => ['url' => 'ftp://x']])]]),
        ]));
        $p = 'sections.0.columns.0.elements';
        foreach ([
            "{$p}.0.props.items", "{$p}.1.props.items", "{$p}.2.props.product_ids", "{$p}.3.props.product_ids.1", "{$p}.3.props.product_ids.2",
            "{$p}.4.props.source", "{$p}.4.props.card_width", "{$p}.4.props.pin", "{$p}.4.props.items.0.caption", "{$p}.4.props.items.1.link.url",
        ] as $path) {
            $this->assertArrayHasKey($path, $errors, $path);
        }
    }

    public function test_the_new_elements_fit_pages_content_pages_shop_areas_and_templates_only(): void
    {
        foreach (ElementRegistry::B19 as $type) {
            $this->assertSame(['page', 'cms', 'zone', 'template'], ElementRegistry::allowedIn($type), $type);
            $this->assertSame('media', ElementRegistry::group($type));
            foreach (['header', 'footer', 'popup'] as $context) {
                $doc = $this->doc([$this->el('e_x', $type, [])]);
                if ($context === 'popup') {
                    $doc['popup'] = null;
                }
                $this->assertArrayHasKey('sections.0.columns.0.elements.0.type', $this->errors($doc, $context), "{$type} in {$context}");
            }
            $this->first($this->doc([$this->el('e_x', $type, [])]), 'template:shop');
        }
    }

    public function test_the_reading_progress_bar_of_pages_content_pages_and_templates(): void
    {
        $normalized = BuilderDocumentSchema::normalize($this->doc([], [], ['scroll_progress' => [], 'motion_theme' => 'calm']));
        $this->assertSame(['schema_version', 'sections', 'motion_theme', 'scroll_progress'], array_keys($normalized));
        $this->assertSame(['position' => 'top', 'color_role' => 'primary', 'thickness' => 3], $normalized['scroll_progress']);
        $this->assertSame($normalized, BuilderDocumentSchema::normalize($normalized));

        $set = ['position' => 'bottom', 'color_role' => 'accent', 'thickness' => 6, 'extra' => true];
        foreach (['page', 'cms', 'template', 'template:blog_post'] as $context) {
            $this->assertSame(['position' => 'bottom', 'color_role' => 'accent', 'thickness' => 6], BuilderDocumentSchema::normalize($this->doc([], [], ['scroll_progress' => $set]), $context)['scroll_progress'], $context);
        }
        $this->assertArrayNotHasKey('scroll_progress', BuilderDocumentSchema::normalize($this->doc([], [], ['scroll_progress' => null])));

        foreach (['header', 'footer', 'zone'] as $context) {
            $this->assertArrayHasKey('scroll_progress', $this->errors($this->doc([], [], ['scroll_progress' => $set]), $context), $context);
        }
        $this->assertArrayHasKey('scroll_progress', $this->errors($this->doc([], [], ['scroll_progress' => $set]), 'page', true));
        $this->assertArrayHasKey('scroll_progress', $this->errors($this->doc([], [], ['scroll_progress' => 'top'])));
        $errors = $this->errors($this->doc([], [], ['scroll_progress' => ['position' => 'left', 'color_role' => 'text', 'thickness' => 7]]));
        $this->assertSame(['scroll_progress.position', 'scroll_progress.color_role', 'scroll_progress.thickness'], array_keys($errors));
        $this->assertArrayHasKey('scroll_progress.thickness', $this->errors($this->doc([], [], ['scroll_progress' => ['thickness' => 1]])));
    }

    public function test_two_starter_section_templates_use_the_new_elements(): void
    {
        $library = new BuilderTemplateLibrary;
        foreach (['neutral-scroll-story' => 'scroll_story', 'neutral-swipe-gallery' => 'horizontal_gallery'] as $id => $type) {
            $template = $library->find($id);
            $this->assertSame(['section', null, null, []], [$template['scope'], $template['preset'], $template['thumbnail'], $template['requires']], $id);
            $this->assertSame(['page', 'cms', 'zone', 'template'], $template['allowed_in']);
            $sections = $library->sections($id, 'page');
            $this->assertContains($type, PortableTemplate::elementTypes($sections));
            // Bundled demo photos only, every one described, with Bangla texts.
            foreach (PortableTemplate::assets($sections) as $asset) {
                $this->assertNotNull($library->assetPath($asset), $asset);
            }
            $this->assertStringContainsString('"bn"', (string) json_encode($sections));
        }
    }

    public function test_the_registry_describes_the_b19_keys_and_elements(): void
    {
        $meta = ElementRegistry::metadata();
        $byType = array_column($meta['types'], null, 'type');
        $this->assertSame(['steps.*.alt', 'steps.*.kicker', 'steps.*.heading', 'steps.*.text', 'steps.*.link.label'], $byType['scroll_story']['translatable']);
        $this->assertSame(['items.*.alt', 'items.*.caption'], $byType['horizontal_gallery']['translatable']);
        $this->assertSame(['Scroll story', 'Horizontal gallery'], [$byType['scroll_story']['label'], $byType['horizontal_gallery']['label']]);
        $this->assertSame([false, false], [$byType['scroll_story']['has_data'], $byType['horizontal_gallery']['has_data']]);
        $this->assertSame('source=products', $meta['data_when']['horizontal_gallery']);

        $enums = $meta['enums'];
        $this->assertSame(['none', 'fade', 'rise', 'sink', 'scale_up', 'scale_down', 'rotate', 'slide_left', 'slide_right', 'blur', 'reveal_up', 'reveal_left', 'reveal_circle'], $enums['scroll_effects']);
        $this->assertSame(['subtle', 'medium', 'strong'], $enums['scroll_intensities']);
        $this->assertSame(['enter', 'cover', 'exit', 'enter_exit'], $enums['scroll_ranges']);
        $this->assertSame(['none', 'zoom_in', 'zoom_out', 'pan_up', 'pan_down'], $enums['background_scrolls']);
        $this->assertSame(['none', 'slow', 'normal'], $enums['ken_burns']);
        $this->assertSame(['alternate', 'in', 'out'], $enums['ken_burns_directions']);
        $this->assertSame(['image', 'image_carousel', 'hero_slider'], $enums['ken_burns_elements']);
        $this->assertSame(['left', 'right'], $enums['scroll_story_media_sides']);
        $this->assertSame(['square', 'portrait', 'landscape'], $enums['scroll_story_media_ratios']);
        $this->assertSame(['fade', 'slide', 'zoom'], $enums['scroll_story_transitions']);
        $this->assertSame(['images', 'products'], $enums['horizontal_gallery_sources']);
        $this->assertSame(['small', 'medium', 'large'], $enums['horizontal_gallery_card_widths']);
        $this->assertSame(['top', 'bottom'], $enums['scroll_progress_positions']);
        $this->assertSame(['primary', 'accent', 'secondary'], $enums['scroll_progress_color_roles']);
        $this->assertSame(['page', 'cms', 'template'], $enums['scroll_progress_contexts']);

        $limits = $meta['limits'];
        $this->assertSame(['min' => 2, 'max' => 6], $limits['lists']['scroll_story.steps']);
        $this->assertSame(['min' => 2, 'max' => 12], $limits['lists']['horizontal_gallery.items']);
        $this->assertSame(['min' => 2, 'max' => 12], $limits['lists']['horizontal_gallery.product_ids']);
        $this->assertSame(ElementRegistry::B19_TEXT_LIMITS, $limits['b19_text']);
        $this->assertSame(['min' => 2, 'max' => 6], $limits['scroll_progress_thickness']);
        $this->assertSame(8, $limits['horizontal_gallery_pin_warn']);
        $this->assertSame(['steps' => ['alt' => 200, 'kicker' => 60, 'heading' => 120, 'text' => 600]], $limits['list_translatable']['scroll_story']);
        $this->assertSame(['steps.*.link.label' => 40], $limits['nested_list_translatable']['scroll_story']);
    }
}
