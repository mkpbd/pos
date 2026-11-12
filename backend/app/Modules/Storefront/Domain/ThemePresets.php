<?php

namespace App\Modules\Storefront\Domain;

use InvalidArgumentException;

/**
 * T1: ready-made looks for the storefront. A preset sets the presentation part of the theme
 * (colours, fonts, shape, layout and the `preset` marker) and never the content: logo,
 * favicon, announcement and footer stay as the shop owner wrote them. Every value stays
 * individually editable after applying a preset.
 *
 * `default` is today's look (ThemeSchema defaults). Text colour pairs meet WCAG AA (4.5:1):
 * primary / primary_foreground, accent / accent_foreground, button / button_foreground (B3),
 * heading, text, sale and link (B3) on canvas and surface (unit tested). The palette is the
 * owner's content and stays as it is.
 */
final class ThemePresets
{
    public const KEYS = ThemeSchema::PRESETS;

    /** The top-level theme keys a preset replaces. */
    public const PRESENTATION_KEYS = ['preset', 'colors', 'typography', 'shape', 'layout'];

    /**
     * The partial theme each preset sets, keyed by preset.
     *
     * @return array<string, array<string, mixed>>
     */
    public static function all(): array
    {
        $defaults = ThemeSchema::defaults();

        return [
            'default' => array_intersect_key($defaults, array_flip(self::PRESENTATION_KEYS)),
            // Organic and modern: fresh greens, a warm yellow accent on cream, rounded shapes.
            'vegan' => [
                'preset' => 'vegan',
                'colors' => [
                    // The accent is also a text colour (store name, outline buttons, link hovers),
                    // so the green is the accent and the warm yellow the primary (dark text on it).
                    'primary' => '#f6c445',
                    'primary_foreground' => '#3a2c00',
                    'accent' => '#2e7d32',
                    'accent_foreground' => '#ffffff',
                    'highlight' => '#7cb342',
                    'sale' => '#c2410c',
                    'heading' => '#1e3a24',
                    'text' => '#4b5a4e',
                    'canvas' => '#fbf8ef',
                    'surface' => '#ffffff',
                    'border' => '#e7e1cc',
                    'button' => '#f6c445',
                    'button_foreground' => '#3a2c00',
                    'link' => '#2e7d32',
                    'button_hover' => null,
                ],
                'typography' => self::typography('baloo', 'poppins'),
                'shape' => ['button_style' => 'pill', 'card_radius' => 16],
                'layout' => [
                    'container_width' => 1200,
                    'sticky_header' => true,
                    'header_style' => 'standard',
                    'footer_style' => 'columns',
                    'card_style' => 'standard',
                    'hero_style' => 'full',
                    'heading_case' => 'lowercase',
                    'top_bar' => 'ticker',
                ],
            ],
            // Premium, artisan and minimal: terracotta and dark brown on off-white, serif headings, square edges.
            'handmade' => [
                'preset' => 'handmade',
                'colors' => [
                    'primary' => '#9c4a2a',
                    'primary_foreground' => '#ffffff',
                    'accent' => '#3b2a20',
                    'accent_foreground' => '#f7f1e8',
                    'highlight' => '#7d8a5a',
                    'sale' => '#a63d1f',
                    'heading' => '#2e211a',
                    'text' => '#5b4a3f',
                    'canvas' => '#f7f2ea',
                    'surface' => '#fffdf9',
                    'border' => '#e3d8c8',
                    'button' => '#9c4a2a',
                    'button_foreground' => '#ffffff',
                    'link' => '#3b2a20',
                    'button_hover' => null,
                ],
                'typography' => self::typography('playfair', 'jost'),
                'shape' => ['button_style' => 'square', 'card_radius' => 0],
                'layout' => [
                    'container_width' => 1240,
                    'sticky_header' => false,
                    'header_style' => 'centered',
                    'footer_style' => 'showcase',
                    'card_style' => 'minimal',
                    'hero_style' => 'tiles',
                    'heading_case' => 'normal',
                    'top_bar' => 'utility',
                ],
            ],
            // Traditional, dense e-commerce: near-black and one strong blue on white, uppercase headings.
            'classic' => [
                'preset' => 'classic',
                'colors' => [
                    'primary' => '#111111',
                    'primary_foreground' => '#ffffff',
                    'accent' => '#1d4ed8',
                    'accent_foreground' => '#ffffff',
                    'highlight' => '#0f766e',
                    'sale' => '#c81e1e',
                    'heading' => '#111111',
                    'text' => '#4b5563',
                    'canvas' => '#ffffff',
                    'surface' => '#ffffff',
                    'border' => '#e5e7eb',
                    'button' => '#111111',
                    'button_foreground' => '#ffffff',
                    'link' => '#1d4ed8',
                    'button_hover' => null,
                ],
                'typography' => self::typography('jost', 'jost'),
                'shape' => ['button_style' => 'rounded', 'card_radius' => 4],
                'layout' => [
                    'container_width' => 1200,
                    'sticky_header' => true,
                    'header_style' => 'commerce',
                    'footer_style' => 'widgets',
                    'card_style' => 'commerce',
                    'hero_style' => 'sale',
                    'heading_case' => 'uppercase',
                    'top_bar' => 'utility',
                ],
            ],
        ];
    }

    public static function exists(string $preset): bool
    {
        return in_array($preset, self::KEYS, true);
    }

    public static function name(string $preset): string
    {
        return match (self::assertKnown($preset)) {
            'default' => 'Default',
            'vegan' => 'Vegan Store',
            'handmade' => 'Handmade',
            'classic' => 'Classic Shop',
        };
    }

    public static function description(string $preset): string
    {
        return match (self::assertKnown($preset)) {
            'default' => 'The original look: amber and violet on a light canvas, rounded headings and pill buttons.',
            'vegan' => 'Organic and modern: fresh greens with a warm yellow accent on cream, lowercase headings and a scrolling announcement.',
            'handmade' => 'Premium and minimal: terracotta and dark brown on off-white, serif headings, a centred header and image-led product cards.',
            'classic' => 'Traditional, dense shop: black and blue on white, uppercase headings, a wide search bar and detailed product cards.',
        };
    }

    /**
     * The complete theme the preset produces on a blank theme.
     *
     * @return array<string, mixed>
     */
    public static function theme(string $preset): array
    {
        return ThemeSchema::normalize(self::all()[self::assertKnown($preset)]);
    }

    /**
     * The theme with the preset's presentation values over it; content (logo, favicon,
     * announcement, footer) is kept.
     *
     * @param  array<string, mixed>  $settings  the current theme
     * @return array<string, mixed>
     */
    public static function apply(string $preset, array $settings): array
    {
        return array_replace(ThemeSchema::normalize($settings), self::all()[self::assertKnown($preset)]);
    }

    /**
     * B3: the preset's fonts with the default type scale — the storefront components already size
     * and weigh each preset's headings, so today's scale keeps every preset's look.
     *
     * @return array<string, mixed>
     */
    private static function typography(string $heading, string $body): array
    {
        return ['heading_font' => $heading, 'body_font' => $body] + ThemeSchema::defaults()['typography'];
    }

    private static function assertKnown(string $preset): string
    {
        if (! self::exists($preset)) {
            throw new InvalidArgumentException("Unknown theme preset [{$preset}].");
        }

        return $preset;
    }
}
