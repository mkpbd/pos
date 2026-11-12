<?php

namespace App\Modules\Storefront\Tests\Unit;

use App\Modules\Storefront\Domain\ThemePresets;
use App\Modules\Storefront\Domain\ThemeSchema;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class ThemePresetsTest extends TestCase
{
    /**
     * @return array<string, array{string}>
     */
    public static function presets(): array
    {
        return array_combine(ThemePresets::KEYS, array_map(fn (string $key) => [$key], ThemePresets::KEYS));
    }

    public function test_every_preset_is_listed_and_default_is_todays_look(): void
    {
        $this->assertSame(ThemeSchema::PRESETS, array_keys(ThemePresets::all()));
        $this->assertSame(ThemeSchema::defaults(), ThemePresets::theme('default'));
    }

    public function test_layout_defaults_are_the_first_variant_of_each_list(): void
    {
        $this->assertSame([
            'container_width' => 1170,
            'sticky_header' => true,
            'header_style' => 'standard',
            'footer_style' => 'columns',
            'card_style' => 'standard',
            'hero_style' => 'full',
            'heading_case' => 'normal',
            'top_bar' => 'none',
            // B4: today's listing grid.
            'listing_columns' => ['desktop' => 3, 'tablet' => 3, 'mobile' => 2],
        ], ThemeSchema::defaults()['layout']);
        $this->assertSame('default', ThemeSchema::defaults()['preset']);

        // A document saved before T1 reads as today's look.
        $old = ThemeSchema::normalize(['layout' => ['container_width' => 1200, 'sticky_header' => false]]);
        $this->assertSame('default', $old['preset']);
        $this->assertSame(['container_width' => 1200, 'sticky_header' => false] + ThemeSchema::defaults()['layout'], $old['layout']);
    }

    #[DataProvider('presets')]
    public function test_a_preset_sets_every_presentation_value_with_allowed_choices(string $key): void
    {
        $partial = ThemePresets::all()[$key];

        $this->assertSame(ThemePresets::PRESENTATION_KEYS, array_keys($partial));
        $this->assertSame($key, $partial['preset']);
        $this->assertSame(ThemeSchema::colorKeys(), array_keys($partial['colors']));
        foreach ($partial['colors'] as $role => $color) {
            if (in_array($role, ThemeSchema::AUTO_COLORS, true) && $color === null) {
                continue;
            }
            $this->assertMatchesRegularExpression('/^#[0-9a-f]{6}$/', $color, $role);
        }
        $this->assertSame(array_keys(ThemeSchema::defaults()['typography']), array_keys($partial['typography']));
        $this->assertContains($partial['typography']['heading_font'], ThemeSchema::HEADING_FONTS);
        $this->assertContains($partial['typography']['body_font'], ThemeSchema::BODY_FONTS);
        foreach (ThemeSchema::TYPE_SCALE as $scale => [$min, $max]) {
            $this->assertThat($partial['typography'][$scale], $this->logicalAnd($this->greaterThanOrEqual($min), $this->lessThanOrEqual($max)), $scale);
        }
        // The palette is the owner's content: presets never set it.
        $this->assertArrayNotHasKey('palette', $partial);
        $this->assertSame(array_keys(ThemeSchema::defaults()['shape']), array_keys($partial['shape']));
        $this->assertContains($partial['shape']['button_style'], ThemeSchema::BUTTON_STYLES);
        $this->assertThat($partial['shape']['card_radius'], $this->logicalAnd($this->greaterThanOrEqual(0), $this->lessThanOrEqual(24)));

        $layout = $partial['layout'];
        // B4: presets do not set the products per row (owner content, kept when applying one).
        $this->assertSame(array_values(array_diff(array_keys(ThemeSchema::defaults()['layout']), ['listing_columns'])), array_keys($layout));
        $this->assertThat($layout['container_width'], $this->logicalAnd($this->greaterThanOrEqual(960), $this->lessThanOrEqual(1440)));
        $this->assertIsBool($layout['sticky_header']);
        $this->assertContains($layout['header_style'], ThemeSchema::HEADER_STYLES);
        $this->assertContains($layout['footer_style'], ThemeSchema::FOOTER_STYLES);
        $this->assertContains($layout['card_style'], ThemeSchema::CARD_STYLES);
        $this->assertContains($layout['hero_style'], ThemeSchema::HERO_STYLES);
        $this->assertContains($layout['heading_case'], ThemeSchema::HEADING_CASES);
        $this->assertContains($layout['top_bar'], ThemeSchema::TOP_BARS);
    }

    #[DataProvider('presets')]
    public function test_text_colours_meet_wcag_aa(string $key): void
    {
        $c = ThemePresets::theme($key)['colors'];
        $pairs = [
            'primary_foreground on primary' => [$c['primary_foreground'], $c['primary']],
            'accent_foreground on accent' => [$c['accent_foreground'], $c['accent']],
            // The storefront also uses the accent as text (brand name, outline buttons, links).
            'accent on canvas' => [$c['accent'], $c['canvas']],
            'accent on surface' => [$c['accent'], $c['surface']],
            'heading on canvas' => [$c['heading'], $c['canvas']],
            'heading on surface' => [$c['heading'], $c['surface']],
            'text on canvas' => [$c['text'], $c['canvas']],
            'text on surface' => [$c['text'], $c['surface']],
            'sale on canvas' => [$c['sale'], $c['canvas']],
            'sale on surface' => [$c['sale'], $c['surface']],
            // B3: the button and link roles.
            'button_foreground on button' => [$c['button_foreground'], $c['button']],
            'link on canvas' => [$c['link'], $c['canvas']],
            'link on surface' => [$c['link'], $c['surface']],
        ];
        if ($c['button_hover'] !== null) {
            $pairs['button_foreground on button_hover'] = [$c['button_foreground'], $c['button_hover']];
        }
        foreach ($pairs as $label => [$fg, $bg]) {
            $this->assertGreaterThanOrEqual(4.5, self::contrast($fg, $bg), "{$key}: {$label} ({$fg} on {$bg})");
        }
    }

    public function test_the_presets_described_in_the_plan(): void
    {
        $vegan = ThemePresets::theme('vegan');
        $this->assertSame(['pill', 16], [$vegan['shape']['button_style'], $vegan['shape']['card_radius']]);
        $this->assertSame(['lowercase', 'ticker'], [$vegan['layout']['heading_case'], $vegan['layout']['top_bar']]);

        $handmade = ThemePresets::theme('handmade');
        $this->assertSame(['heading_font' => 'playfair', 'body_font' => 'jost'] + ThemeSchema::defaults()['typography'], $handmade['typography']);
        $this->assertSame(['square', 0], [$handmade['shape']['button_style'], $handmade['shape']['card_radius']]);
        $this->assertSame([1240, 'centered', 'showcase', 'minimal', 'tiles', 'normal', 'utility'], [
            $handmade['layout']['container_width'], $handmade['layout']['header_style'], $handmade['layout']['footer_style'],
            $handmade['layout']['card_style'], $handmade['layout']['hero_style'], $handmade['layout']['heading_case'], $handmade['layout']['top_bar'],
        ]);

        $classic = ThemePresets::theme('classic');
        $this->assertSame(['heading_font' => 'jost', 'body_font' => 'jost'] + ThemeSchema::defaults()['typography'], $classic['typography']);
        // B3: buttons and links keep each preset's look (the primary pair and the accent).
        foreach (ThemePresets::KEYS as $key) {
            $c = ThemePresets::theme($key)['colors'];
            $this->assertSame([$c['primary'], $c['primary_foreground'], $c['accent'], null], [$c['button'], $c['button_foreground'], $c['link'], $c['button_hover']], $key);
        }
        $this->assertSame(['rounded', 4], [$classic['shape']['button_style'], $classic['shape']['card_radius']]);
        $this->assertSame(['#ffffff', 'commerce', 'widgets', 'commerce', 'sale', 'uppercase', 'utility'], [
            $classic['colors']['canvas'], $classic['layout']['header_style'], $classic['layout']['footer_style'],
            $classic['layout']['card_style'], $classic['layout']['hero_style'], $classic['layout']['heading_case'], $classic['layout']['top_bar'],
        ]);
    }

    public function test_applying_keeps_the_content(): void
    {
        $current = ThemeSchema::normalize([
            'colors' => ['primary' => '#123456'],
            'palette' => [['name' => 'Brand', 'hex' => '#123456']],
            'logo_media_id' => 'logo',
            'favicon_media_id' => 'icon',
            'announcement' => ['enabled' => true, 'text' => 'Hello'],
            'footer' => ['about' => 'About us', 'contact' => ['phone' => '017']],
        ]);

        $applied = ThemePresets::apply('handmade', $current);

        $this->assertSame(array_keys(ThemeSchema::defaults()), array_keys($applied));
        $this->assertSame(ThemePresets::theme('handmade')['colors'], $applied['colors']);
        $this->assertSame('handmade', $applied['preset']);
        foreach (['palette', 'logo_media_id', 'favicon_media_id', 'announcement', 'footer'] as $content) {
            $this->assertSame($current[$content], $applied[$content], $content);
        }
    }

    public function test_unknown_presets_are_refused(): void
    {
        $this->assertFalse(ThemePresets::exists('neon'));
        $this->expectException(InvalidArgumentException::class);
        ThemePresets::apply('neon', []);
    }

    /**
     * WCAG 2 contrast ratio of two #rrggbb colours.
     */
    private static function contrast(string $a, string $b): float
    {
        $luminance = function (string $hex): float {
            $channels = array_map(function (int $i) use ($hex): float {
                $v = hexdec(substr($hex, 1 + 2 * $i, 2)) / 255;

                return $v <= 0.03928 ? $v / 12.92 : (($v + 0.055) / 1.055) ** 2.4;
            }, [0, 1, 2]);

            return 0.2126 * $channels[0] + 0.7152 * $channels[1] + 0.0722 * $channels[2];
        };
        [$x, $y] = [$luminance($a), $luminance($b)];

        return (max($x, $y) + 0.05) / (min($x, $y) + 0.05);
    }
}
