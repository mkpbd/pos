<?php

namespace App\Modules\Storefront\Tests\Unit;

use App\Modules\Storefront\Application\Builder\Templates\BuilderTemplateLibrary;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use App\Modules\Storefront\Domain\Builder\StyleSchema;
use App\Modules\Storefront\Domain\Builder\Templates\PortableTemplate;
use App\Modules\Storefront\Domain\ThemePresets;
use App\Modules\Storefront\Domain\ThemeSchema;
use Tests\TestCase;

/**
 * B20 (animated graphics): the animated_icon and illustration elements (limits, contexts,
 * translations, the custom colour), `style.base.background_fx` on sections and inner rows, the
 * theme's optional `effects` group — all optional and kept only when set — the two starter
 * section templates and the registry's enums, limits and elements.
 */
class BuilderB20SchemaTest extends TestCase
{
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
     * @return array<string, string> path => message
     */
    private function errors(array $document, string $context = 'page'): array
    {
        try {
            BuilderDocumentSchema::normalize($document, $context);
        } catch (InvalidBuilderDocument $e) {
            return array_column($e->errors, 'message', 'path');
        }
        $this->fail('The document was accepted.');
    }

    public function test_an_animated_icon_takes_the_defaults_and_keeps_valid_values(): void
    {
        $icon = $this->first($this->doc([$this->el('e_icon', 'animated_icon', [])]));
        $this->assertSame([
            'name' => 'delivery_truck', 'animation' => 'draw', 'trigger' => 'view', 'size' => 64, 'stroke' => 2,
            'color_role' => 'primary', 'background' => 'none', 'label' => '',
        ], $icon['props']);

        $set = [
            'name' => 'mobile_wallet', 'animation' => 'wiggle', 'trigger' => 'loop', 'size' => 160, 'stroke' => 3,
            'color_role' => 'accent', 'background' => 'soft', 'label' => 'Pay with your phone', 'extra' => true,
        ];
        $icon = $this->first($this->doc([$this->el('e_icon', 'animated_icon', $set, ['translations' => ['bn' => ['label' => 'ফোনে পেমেন্ট']]])]));
        unset($set['extra']);
        $this->assertSame($set, $icon['props']);
        $this->assertSame(['bn' => ['label' => 'ফোনে পেমেন্ট']], $icon['translations']);
        // Normalizing the result changes nothing.
        $this->assertSame($icon, $this->first($this->doc([$icon])));

        // Every animation, trigger, background and colour role (the custom one with its colour).
        foreach (ElementRegistry::ANIMATED_ICON_ANIMATIONS as $animation) {
            $this->assertSame($animation, $this->first($this->doc([$this->el('e_icon', 'animated_icon', ['animation' => $animation])]))['props']['animation']);
        }
        foreach (ElementRegistry::ANIMATED_ICON_TRIGGERS as $trigger) {
            $this->assertSame($trigger, $this->first($this->doc([$this->el('e_icon', 'animated_icon', ['trigger' => $trigger])]))['props']['trigger']);
        }
        foreach (ElementRegistry::ANIMATED_ICON_BACKGROUNDS as $background) {
            $this->assertSame($background, $this->first($this->doc([$this->el('e_icon', 'animated_icon', ['background' => $background])]))['props']['background']);
        }
        foreach (ElementRegistry::animatedIconNames() as $name) {
            $this->assertSame($name, $this->first($this->doc([$this->el('e_icon', 'animated_icon', ['name' => $name])]))['props']['name']);
        }
    }

    public function test_an_animated_icon_keeps_a_custom_colour_only_with_the_custom_role(): void
    {
        $icon = $this->first($this->doc([$this->el('e_icon', 'animated_icon', ['color_role' => 'custom', 'color' => '#AA3300'])]));
        $this->assertSame(['custom', '#aa3300'], [$icon['props']['color_role'], $icon['props']['color']]);
        $this->assertSame('color', array_key_last($icon['props']));

        // A colour with a theme role is not kept.
        foreach (['primary', 'accent', 'secondary', 'text'] as $role) {
            $icon = $this->first($this->doc([$this->el('e_icon', 'animated_icon', ['color_role' => $role, 'color' => '#aa3300'])]));
            $this->assertArrayNotHasKey('color', $icon['props'], $role);
        }

        // The custom role needs a #rrggbb colour.
        foreach ([null, '#abc', '#aa330080', 'theme:primary', 'red', 12] as $color) {
            $props = ['color_role' => 'custom'] + ($color === null ? [] : ['color' => $color]);
            $this->assertArrayHasKey('sections.0.columns.0.elements.0.props.color', $this->errors($this->doc([$this->el('e_icon', 'animated_icon', $props)])), (string) json_encode($color));
        }
    }

    public function test_invalid_animated_icon_props_are_refused_with_their_paths(): void
    {
        $errors = $this->errors($this->doc([$this->el('e_icon', 'animated_icon', [
            'name' => 'truck', 'animation' => 'fade', 'trigger' => 'click', 'size' => 23, 'stroke' => 4,
            'color_role' => 'sale', 'background' => 'star', 'label' => str_repeat('x', 81),
        ])]));
        $p = 'sections.0.columns.0.elements.0.props';
        $this->assertSame(array_map(fn (string $key) => "{$p}.{$key}", ['name', 'animation', 'trigger', 'size', 'stroke', 'color_role', 'background', 'label']), array_keys($errors));
        $this->assertArrayHasKey("{$p}.size", $this->errors($this->doc([$this->el('e_icon', 'animated_icon', ['size' => 161])])));
        $this->assertArrayHasKey("{$p}.stroke", $this->errors($this->doc([$this->el('e_icon', 'animated_icon', ['stroke' => 0])])));
        $this->assertArrayHasKey("{$p}.stroke", $this->errors($this->doc([$this->el('e_icon', 'animated_icon', ['stroke' => 1.5])])));
        // Limits are inclusive; 80 characters of label is fine, its translation too.
        $icon = $this->first($this->doc([$this->el('e_icon', 'animated_icon', ['size' => 24, 'stroke' => 1, 'label' => str_repeat('x', 80)], ['translations' => ['bn' => ['label' => str_repeat('ক', 80)]]])]));
        $this->assertSame([24, 1], [$icon['props']['size'], $icon['props']['stroke']]);
        $this->assertArrayHasKey('sections.0.columns.0.elements.0.translations.bn.label', $this->errors($this->doc([$this->el('e_icon', 'animated_icon', [], ['translations' => ['bn' => ['label' => str_repeat('ক', 81)]]])])));
    }

    public function test_an_illustration_takes_the_defaults_and_checks_every_prop(): void
    {
        $illustration = $this->first($this->doc([$this->el('e_ill', 'illustration', [])]));
        $this->assertSame(['name' => 'delivery_scene', 'play' => 'view', 'size' => 'medium', 'align' => 'center', 'palette' => 'theme', 'alt' => ''], $illustration['props']);

        $set = ['name' => 'eid_lanterns', 'play' => 'loop', 'size' => 'large', 'align' => 'right', 'palette' => 'mono', 'alt' => 'Lanterns swaying'];
        $illustration = $this->first($this->doc([$this->el('e_ill', 'illustration', $set + ['junk' => 1], ['translations' => ['bn' => ['alt' => 'দুলছে লণ্ঠন']]])]));
        $this->assertSame($set, $illustration['props']);
        $this->assertSame(['bn' => ['alt' => 'দুলছে লণ্ঠন']], $illustration['translations']);
        $this->assertSame($illustration, $this->first($this->doc([$illustration])));
        foreach (array_keys(ElementRegistry::ILLUSTRATIONS) as $name) {
            $this->assertSame($name, $this->first($this->doc([$this->el('e_ill', 'illustration', ['name' => $name])]))['props']['name']);
        }
        // An empty description (decorative) arrives as null too.
        $this->assertSame('', $this->first($this->doc([$this->el('e_ill', 'illustration', ['alt' => null])]))['props']['alt']);

        $errors = $this->errors($this->doc([$this->el('e_ill', 'illustration', [
            'name' => 'castle', 'play' => 'hover_twice', 'size' => 'huge', 'align' => 'justify', 'palette' => 'rainbow', 'alt' => str_repeat('x', 201),
        ])]));
        $p = 'sections.0.columns.0.elements.0.props';
        $this->assertSame(array_map(fn (string $key) => "{$p}.{$key}", ['name', 'play', 'size', 'align', 'palette', 'alt']), array_keys($errors));
    }

    public function test_where_the_new_elements_may_be_used(): void
    {
        $this->assertSame(ElementRegistry::allowedIn('icon'), ElementRegistry::allowedIn('animated_icon'));
        $this->assertSame(['page', 'cms', 'header', 'footer', 'zone', 'template', 'popup'], ElementRegistry::allowedIn('animated_icon'));
        $this->assertSame(['page', 'cms', 'zone', 'template', 'popup'], ElementRegistry::allowedIn('illustration'));
        foreach (ElementRegistry::B20 as $type) {
            $this->assertSame('media', ElementRegistry::group($type));
            $this->assertNull(ElementRegistry::sectionType($type));
            $this->assertFalse(ElementRegistry::hasData($type));
            $this->first($this->doc([$this->el('e_x', $type, [])]), 'template:shop');
            $this->first($this->doc([$this->el('e_x', $type, [])]), 'cms');
        }
        $this->first($this->doc([$this->el('e_x', 'animated_icon', [])]), 'header');
        $this->first($this->doc([$this->el('e_x', 'animated_icon', [])]), 'footer');
        foreach (['header', 'footer'] as $context) {
            $this->assertSame('ELEMENT_NOT_ALLOWED', $this->errorCode($this->doc([$this->el('e_x', 'illustration', [])]), $context), $context);
        }
        // Both in popups and bars.
        $popup = BuilderDocumentSchema::normalize($this->doc([$this->el('e_i', 'animated_icon', []), $this->el('e_x', 'illustration', [])]) + ['popup' => null], 'popup');
        $this->assertSame(['animated_icon', 'illustration'], array_column($popup['sections'][0]['columns'][0]['elements'], 'type'));
    }

    private function errorCode(array $document, string $context): ?string
    {
        try {
            BuilderDocumentSchema::normalize($document, $context);
        } catch (InvalidBuilderDocument $e) {
            return $e->errors[0]['code'] ?? null;
        }
        $this->fail('The document was accepted.');
    }

    public function test_a_moving_background_on_sections_and_inner_rows_only_kept_when_set(): void
    {
        $fx = ['type' => 'sparkles', 'density' => 'high', 'speed' => 'normal', 'colors' => ['accent', 'surface'], 'extra' => 1];
        $inner = $this->el('e_row', 'inner_row', [], [
            'style' => ['base' => ['background_fx' => ['type' => 'snow']]],
            'columns' => [['id' => 'c_in', 'width' => ['base' => 100], 'style' => ['base' => ['background_fx' => $fx]], 'elements' => [
                $this->el('e_text', 'heading', ['text' => 'Hi'], ['style' => ['base' => ['background_fx' => $fx]]]),
            ]]],
        ]);
        $doc = $this->doc([$inner], ['style' => [
            'base' => ['background_fx' => $fx, 'spacing' => ['padding' => ['top' => '10px']]],
            'tablet' => ['background_fx' => $fx],
            'mobile' => ['background_fx' => $fx],
        ]]);
        $normalized = BuilderDocumentSchema::normalize($doc);
        $section = $normalized['sections'][0];
        $this->assertSame(['type' => 'sparkles', 'density' => 'high', 'speed' => 'normal', 'colors' => ['accent', 'surface']], $section['style']['base']['background_fx']);
        // Base only.
        $this->assertSame(['base'], array_keys($section['style']));
        $row = $section['columns'][0]['elements'][0];
        $this->assertSame(['type' => 'snow'], $row['style']['base']['background_fx']);
        // Not on columns or elements.
        $this->assertSame([], $row['columns'][0]['style']);
        $this->assertSame([], $row['columns'][0]['elements'][0]['style']);
        $this->assertSame($normalized, BuilderDocumentSchema::normalize($normalized));

        // Every type and option.
        foreach (array_diff(StyleSchema::BACKGROUND_FX_TYPES, ['none']) as $type) {
            $this->assertSame(['type' => $type], StyleSchema::normalize(['base' => ['background_fx' => ['type' => $type]]], true)['base']['background_fx']);
        }
        foreach (StyleSchema::BACKGROUND_FX_DENSITIES as $density) {
            $this->assertSame($density, StyleSchema::normalize(['base' => ['background_fx' => ['type' => 'bubbles', 'density' => $density]]], true)['base']['background_fx']['density']);
        }
        foreach (StyleSchema::BACKGROUND_FX_SPEEDS as $speed) {
            $this->assertSame($speed, StyleSchema::normalize(['base' => ['background_fx' => ['type' => 'bubbles', 'speed' => $speed]]], true)['base']['background_fx']['speed']);
        }
    }

    public function test_a_moving_background_drops_what_is_unset_or_invalid_silently(): void
    {
        $style = fn (mixed $fx) => StyleSchema::normalize(['base' => ['background_fx' => $fx]], true);
        // None, absent, unknown or malformed: the group is dropped (and the style with it).
        foreach ([null, 'snow', [], ['type' => 'none'], ['type' => 'fireworks'], ['density' => 'high'], ['type' => ['snow']]] as $fx) {
            $this->assertSame([], $style($fx), (string) json_encode($fx));
        }
        // Invalid options are dropped, the rest kept.
        $this->assertSame(['type' => 'petals'], $style(['type' => 'petals', 'density' => 'extreme', 'speed' => 'fast', 'colors' => 'primary'])['base']['background_fx']);
        // Colours: theme roles once each, at most 3; none left = no colours key.
        $this->assertSame(['primary', 'accent', 'secondary'], $style(['type' => 'stars', 'colors' => ['primary', 'canvas', 'accent', 'primary', 'secondary', 'surface']])['base']['background_fx']['colors']);
        $this->assertSame(['surface'], $style(['type' => 'stars', 'colors' => ['surface', '#ffffff']])['base']['background_fx']['colors']);
        $this->assertArrayNotHasKey('colors', $style(['type' => 'stars', 'colors' => []])['base']['background_fx']);
        $this->assertArrayNotHasKey('colors', $style(['type' => 'stars', 'colors' => ['theme:primary', 'text']])['base']['background_fx']);
        $this->assertArrayNotHasKey('colors', $style(['type' => 'stars', 'colors' => ['a' => 'primary']])['base']['background_fx']);
        // Not where the node is no container.
        $this->assertSame([], StyleSchema::normalize(['base' => ['background_fx' => ['type' => 'snow']]]));

        // An older document without it normalizes unchanged.
        $old = BuilderDocumentSchema::normalize($this->doc([], ['style' => ['base' => ['background' => ['type' => 'color', 'color' => '#ffffff']]]]));
        $this->assertSame(['background' => ['type' => 'color', 'color' => '#ffffff']], $old['sections'][0]['style']['base']);
    }

    public function test_the_theme_effects_group_is_optional_and_kept_only_when_set(): void
    {
        $defaults = ThemeSchema::defaults();
        $this->assertArrayNotHasKey('effects', $defaults);
        $this->assertArrayNotHasKey('effects', ThemeSchema::normalize([]));
        $this->assertArrayNotHasKey('effects', ThemeSchema::normalize(['effects' => null]));
        $this->assertSame(['add_to_cart' => 'bump', 'button_feedback' => true], ThemeSchema::effects(ThemeSchema::normalize([])));

        $set = ThemeSchema::normalize(['effects' => ['add_to_cart' => 'fly', 'button_feedback' => false, 'sparkle' => true]]);
        $this->assertSame(['add_to_cart' => 'fly', 'button_feedback' => false], $set['effects']);
        $this->assertSame($set, ThemeSchema::normalize($set));
        $this->assertSame(['add_to_cart' => 'fly', 'button_feedback' => false], ThemeSchema::effects($set));
        // Missing or invalid keys take the defaults; stored booleans in other forms are read.
        $this->assertSame(['add_to_cart' => 'bump', 'button_feedback' => true], ThemeSchema::normalize(['effects' => []])['effects']);
        $this->assertSame(['add_to_cart' => 'none', 'button_feedback' => true], ThemeSchema::normalize(['effects' => ['add_to_cart' => 'none']])['effects']);
        $this->assertSame(['add_to_cart' => 'bump', 'button_feedback' => false], ThemeSchema::normalize(['effects' => ['add_to_cart' => 'zoom', 'button_feedback' => '0']])['effects']);
        $this->assertSame(true, ThemeSchema::normalize(['effects' => ['button_feedback' => 1]])['effects']['button_feedback']);

        // Old themes stay the same theme; a preset keeps the effects (store behaviour, not look).
        $this->assertTrue(ThemeSchema::same([], ThemeSchema::normalize([])));
        $this->assertFalse(ThemeSchema::same([], ['effects' => ['add_to_cart' => 'fly']]));
        $applied = ThemePresets::apply('classic', $set);
        $this->assertSame(['add_to_cart' => 'fly', 'button_feedback' => false], ThemeSchema::normalize($applied)['effects']);
        $this->assertArrayNotHasKey('effects', ThemePresets::apply('classic', []));
        $this->assertArrayNotHasKey('effects', ThemePresets::theme('vegan'));
    }

    public function test_two_starter_section_templates_use_the_new_elements(): void
    {
        $library = new BuilderTemplateLibrary;
        foreach (['neutral-why-us-animated' => ['features', 'animated_icon'], 'neutral-delivery-banner' => ['promo', 'illustration']] as $id => [$category, $type]) {
            $template = $library->find($id);
            $this->assertSame(['section', null, null, [], $category], [$template['scope'], $template['preset'], $template['thumbnail'], $template['requires'], $template['category']], $id);
            $this->assertSame(['page', 'cms', 'zone', 'template'], $template['allowed_in']);
            $sections = $library->sections($id, 'page');
            $this->assertContains($type, PortableTemplate::elementTypes($sections));
            // No pictures at all; Bangla texts.
            $this->assertSame([], PortableTemplate::assets($sections), $id);
            $this->assertStringContainsString('"bn"', (string) json_encode($sections));
            // Valid as a page section.
            BuilderDocumentSchema::normalize(['schema_version' => 1, 'sections' => $sections]);
        }
        $why = (string) json_encode($library->sections('neutral-why-us-animated', 'page'));
        foreach (['delivery_truck', 'cash_on_delivery', 'return_box', 'headset'] as $icon) {
            $this->assertStringContainsString("\"{$icon}\"", $why);
        }
        $banner = $library->sections('neutral-delivery-banner', 'page');
        $this->assertSame('floating_shapes', $banner[0]['style']['base']['background_fx']['type']);
        $this->assertStringContainsString('"delivery_scene"', (string) json_encode($banner));
    }

    public function test_the_registry_describes_the_b20_keys_and_elements(): void
    {
        $meta = ElementRegistry::metadata();
        $byType = array_column($meta['types'], null, 'type');
        $this->assertSame(['label'], $byType['animated_icon']['translatable']);
        $this->assertSame(['alt'], $byType['illustration']['translatable']);
        $this->assertSame(['Animated icon', 'Illustration'], [$byType['animated_icon']['label'], $byType['illustration']['label']]);
        $this->assertSame([false, false], [$byType['animated_icon']['has_data'], $byType['illustration']['has_data']]);
        $this->assertEquals((object) ElementRegistry::defaults('animated_icon'), $byType['animated_icon']['props']);

        $enums = $meta['enums'];
        $names = $enums['animated_icon_names'];
        $this->assertGreaterThanOrEqual(40, count($names));
        $this->assertSame($names, array_values(array_unique($names)));
        foreach ($names as $name) {
            $this->assertMatchesRegularExpression('/^[a-z][a-z_]*[a-z]$/', $name);
        }
        // The groups hold every icon once; every icon has en + bn keywords.
        $this->assertSame(['delivery', 'payment', 'returns', 'offers', 'time', 'contact', 'shopping', 'praise', 'nature'], array_column($enums['animated_icon_groups'], 'key'));
        $this->assertSame(['key', 'label', 'label_bn', 'icons'], array_keys($enums['animated_icon_groups'][0]));
        $this->assertSame(['Delivery', 'ডেলিভারি'], [$enums['animated_icon_groups'][0]['label'], $enums['animated_icon_groups'][0]['label_bn']]);
        $this->assertSame($names, array_merge(...array_column($enums['animated_icon_groups'], 'icons')));
        $this->assertEqualsCanonicalizing($names, array_keys($enums['animated_icon_keywords']));
        foreach ($enums['animated_icon_keywords'] as $name => $words) {
            $this->assertSame(['en', 'bn'], array_keys($words), $name);
            $this->assertNotEmpty($words['en'], $name);
            $this->assertNotEmpty($words['bn'], $name);
            $this->assertNotContains('whatsapp', array_map('strtolower', $words['en']), $name);
        }
        $this->assertSame(['draw', 'pop', 'bounce', 'spin', 'pulse', 'wiggle', 'float', 'none'], $enums['animated_icon_animations']);
        $this->assertSame(['view', 'hover', 'loop'], $enums['animated_icon_triggers']);
        $this->assertSame(['primary', 'accent', 'secondary', 'text', 'custom'], $enums['animated_icon_color_roles']);
        $this->assertSame(['none', 'circle', 'square', 'soft'], $enums['animated_icon_backgrounds']);
        $this->assertSame(['delivery_scene', 'shopping_bag_pop', 'sale_tag_swing', 'gift_unwrap', 'phone_order', 'parcel_journey', 'happy_shopper', 'eid_lanterns'], $enums['illustration_names']);
        $this->assertSame(['en' => 'Eid lanterns', 'bn' => 'ঈদের লণ্ঠন'], $enums['illustration_labels']['eid_lanterns']);
        $this->assertSame(['view', 'loop', 'hover'], $enums['illustration_plays']);
        $this->assertSame(['small', 'medium', 'large'], $enums['illustration_sizes']);
        $this->assertSame(['theme', 'mono'], $enums['illustration_palettes']);
        $this->assertSame(['none', 'gradient_flow', 'floating_shapes', 'bubbles', 'sparkles', 'snow', 'petals', 'lanterns', 'confetti_fall', 'stars'], $enums['background_fx_types']);
        $this->assertSame(['low', 'medium', 'high'], $enums['background_fx_densities']);
        $this->assertSame(['slow', 'normal'], $enums['background_fx_speeds']);
        $this->assertSame(['primary', 'accent', 'secondary', 'surface'], $enums['background_fx_color_roles']);
        $this->assertSame(array_values(array_diff($enums['background_fx_types'], ['none'])), array_keys($enums['background_fx_default_colors']));
        foreach ($enums['background_fx_default_colors'] as $roles) {
            $this->assertSame([], array_diff($roles, $enums['background_fx_color_roles']));
        }
        $this->assertSame(['fly', 'bump', 'none'], $enums['theme_add_to_cart_effects']);
        $this->assertSame(['add_to_cart' => 'bump', 'button_feedback' => true], $enums['theme_effects_defaults']);

        $limits = $meta['limits'];
        $this->assertSame(['min' => 24, 'max' => 160], $limits['animated_icon_size']);
        $this->assertSame(['min' => 1, 'max' => 3], $limits['animated_icon_stroke']);
        $this->assertSame(['min' => 1, 'max' => 3], $limits['background_fx_colors']);
        $this->assertSame([2, 6], [$limits['background_fx_warn'], $limits['icon_loop_warn']]);
        $this->assertSame(['label' => 80], $limits['translatable']['animated_icon']);
        $this->assertSame(['alt' => 200], $limits['translatable']['illustration']);
    }
}
