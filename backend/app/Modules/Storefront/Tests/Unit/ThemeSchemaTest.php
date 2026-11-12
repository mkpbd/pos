<?php

namespace App\Modules\Storefront\Tests\Unit;

use App\Modules\Storefront\Domain\ThemeSchema;
use PHPUnit\Framework\TestCase;

/**
 * B3: the design-control keys of the theme and their back-compatible defaults.
 */
class ThemeSchemaTest extends TestCase
{
    /** A theme as stored before B3 (T1 shape), with its own colours. */
    private const OLD_THEME = [
        'preset' => 'vegan',
        'colors' => [
            'primary' => '#123456', 'primary_foreground' => '#ffffff', 'accent' => '#2e7d32', 'accent_foreground' => '#ffffff',
            'highlight' => '#7cb342', 'sale' => '#c2410c', 'heading' => '#1e3a24', 'text' => '#4b5a4e',
            'canvas' => '#fbf8ef', 'surface' => '#ffffff', 'border' => '#e7e1cc',
        ],
        'typography' => ['heading_font' => 'playfair', 'body_font' => 'jost'],
        'shape' => ['button_style' => 'square', 'card_radius' => 0],
        'layout' => ['container_width' => 1240, 'sticky_header' => false, 'header_style' => 'centered', 'footer_style' => 'showcase', 'card_style' => 'minimal', 'hero_style' => 'tiles', 'heading_case' => 'lowercase', 'top_bar' => 'ticker'],
    ];

    public function test_the_new_keys_and_their_defaults(): void
    {
        $defaults = ThemeSchema::defaults();

        $this->assertSame(ThemeSchema::colorKeys(), array_keys($defaults['colors']));
        // Buttons are painted in the primary pair, links in the accent; hover stays automatic.
        $this->assertSame(['#f59e0b', '#3b2500', '#6f55c2', null], [
            $defaults['colors']['button'], $defaults['colors']['button_foreground'], $defaults['colors']['link'], $defaults['colors']['button_hover'],
        ]);
        $this->assertSame([
            'heading_font' => 'baloo',
            'body_font' => 'poppins',
            'body_size' => 16,
            'heading_scale' => 1.25,
            'line_height' => 1.5,
            'heading_weight' => 700,
            'mobile_scale' => 1,
            'letter_spacing' => 0,
        ], $defaults['typography']);
        $this->assertSame([], $defaults['palette']);
        $this->assertSame($defaults, ThemeSchema::normalize([]));
        $this->assertSame($defaults, ThemeSchema::normalize($defaults));
    }

    public function test_an_old_theme_reads_the_same_with_the_new_keys_following_its_own_colours(): void
    {
        $normalized = ThemeSchema::normalize(self::OLD_THEME);

        // Everything that was there is unchanged.
        $this->assertSame('vegan', $normalized['preset']);
        $this->assertSame(self::OLD_THEME['shape'], $normalized['shape']);
        $this->assertSame(self::OLD_THEME['layout'], $normalized['layout']);
        $this->assertSame(self::OLD_THEME['colors'], array_intersect_key($normalized['colors'], self::OLD_THEME['colors']));
        // The new colour roles copy this theme's primary pair and accent (not the default ones).
        $this->assertSame(['#123456', '#ffffff', '#2e7d32', null], [
            $normalized['colors']['button'], $normalized['colors']['button_foreground'], $normalized['colors']['link'], $normalized['colors']['button_hover'],
        ]);
        // The type scale and palette take their defaults.
        $this->assertSame(['heading_font' => 'playfair', 'body_font' => 'jost'] + ThemeSchema::defaults()['typography'], $normalized['typography']);
        $this->assertSame([], $normalized['palette']);
        $this->assertSame(array_keys(ThemeSchema::defaults()), array_keys($normalized));

        // Normalizing twice changes nothing; explicit new values win over the derived ones.
        $this->assertSame($normalized, ThemeSchema::normalize($normalized));
        $explicit = ThemeSchema::normalize(['colors' => ['primary' => '#000000', 'button' => '#ff0000', 'link' => '#00ff00', 'button_hover' => '#aa0000']]);
        $this->assertSame(['#ff0000', '#3b2500', '#00ff00', '#aa0000'], [
            $explicit['colors']['button'], $explicit['colors']['button_foreground'], $explicit['colors']['link'], $explicit['colors']['button_hover'],
        ]);
    }

    public function test_type_scale_numbers_and_palette_entries_have_one_form(): void
    {
        $normalized = ThemeSchema::normalize([
            'typography' => ['body_size' => '17', 'heading_scale' => '1.2', 'line_height' => 1.6000001, 'heading_weight' => 800.0, 'mobile_scale' => 1.0, 'letter_spacing' => -0.0],
            'palette' => [['name' => ' Brand ', 'hex' => '#ABCDEF', 'extra' => true], 'junk', ['name' => 'No hex'], ['name' => 'Glass', 'hex' => '#FFFFFF80']],
        ]);

        $this->assertSame([17, 1.2, 1.6, 800, 1, 0], array_values(array_slice($normalized['typography'], 2)));
        $this->assertSame([['name' => 'Brand', 'hex' => '#abcdef'], ['name' => 'Glass', 'hex' => '#ffffff80']], $normalized['palette']);
        $this->assertSame([], ThemeSchema::normalize(['palette' => 'none'])['palette']);
    }

    public function test_same_compares_normalized_documents(): void
    {
        $a = ThemeSchema::normalize(self::OLD_THEME);
        $b = array_reverse($a, true);
        $b['typography'] = array_reverse($b['typography'], true);

        $this->assertTrue(ThemeSchema::same($a, $b));
        $this->assertTrue(ThemeSchema::same(self::OLD_THEME, $a));
        $this->assertTrue(ThemeSchema::same([], ThemeSchema::defaults()));
        $this->assertFalse(ThemeSchema::same($a, ['colors' => ['button' => '#000000']] + $a));
    }
}
