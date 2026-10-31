<?php

namespace App\Modules\Storefront\Domain;

/**
 * The theme settings document: its default values and normalization. Stored settings
 * always hold every key, so the storefront never has to guess. Unknown keys are dropped;
 * missing keys take their defaults. Validation of values lives with the HTTP request.
 *
 * Default colours meet WCAG AA for the text placed on them (see UI_REFERENCE_ANALYSIS §12).
 */
final class ThemeSchema
{
    public const HEADING_FONTS = ['baloo', 'poppins', 'system'];

    public const BODY_FONTS = ['poppins', 'system'];

    public const BUTTON_STYLES = ['pill', 'rounded', 'square'];

    public const SOCIAL_NETWORKS = ['facebook', 'instagram', 'youtube', 'tiktok', 'x', 'linkedin'];

    public const COLORS = ['primary', 'primary_foreground', 'accent', 'accent_foreground', 'highlight', 'sale', 'heading', 'text', 'canvas', 'surface', 'border'];

    public const MAX_PAYMENT_LOGOS = 10;

    /**
     * @return array<string, mixed>
     */
    public static function defaults(): array
    {
        return [
            'colors' => [
                'primary' => '#f59e0b',
                'primary_foreground' => '#3b2500',
                'accent' => '#6f55c2',
                'accent_foreground' => '#ffffff',
                'highlight' => '#2fb79a',
                'sale' => '#c2410c',
                'heading' => '#3d3d3d',
                'text' => '#5f6368',
                'canvas' => '#f3f7fa',
                'surface' => '#ffffff',
                'border' => '#e1e1e1',
            ],
            'typography' => ['heading_font' => 'baloo', 'body_font' => 'poppins'],
            'shape' => ['button_style' => 'pill', 'card_radius' => 12],
            'layout' => ['container_width' => 1170, 'sticky_header' => true],
            'logo_media_id' => null,
            'favicon_media_id' => null,
            'announcement' => [
                'enabled' => false,
                'text' => null,
                'link' => null,
                'background' => '#6f55c2',
                'foreground' => '#ffffff',
                'starts_at' => null,
                'ends_at' => null,
            ],
            'footer' => [
                'about' => null,
                'copyright' => null,
                'contact' => ['email' => null, 'phone' => null, 'address' => null],
                'social' => array_fill_keys(self::SOCIAL_NETWORKS, null),
                'payment_logo_media_ids' => [],
            ],
        ];
    }

    /**
     * @param  array<string, mixed>  $settings
     * @return array<string, mixed>
     */
    public static function normalize(array $settings): array
    {
        return self::merge(self::defaults(), $settings);
    }

    /**
     * Every media id the theme points at (logo, favicon, payment logos).
     *
     * @param  array<string, mixed>  $settings  normalized
     * @return list<string>
     */
    public static function mediaIds(array $settings): array
    {
        return array_values(array_unique(array_filter([
            $settings['logo_media_id'],
            $settings['favicon_media_id'],
            ...$settings['footer']['payment_logo_media_ids'],
        ], 'is_string')));
    }

    /**
     * Defaults define the shape: associative arrays recurse, lists and scalars are taken
     * from the input when present.
     *
     * @param  array<string, mixed>  $defaults
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    private static function merge(array $defaults, array $input): array
    {
        $result = [];
        foreach ($defaults as $key => $default) {
            if (! array_key_exists($key, $input)) {
                $result[$key] = $default;
            } elseif (is_array($default) && ! array_is_list($default) && is_array($input[$key])) {
                $result[$key] = self::merge($default, $input[$key]);
            } else {
                $result[$key] = $input[$key];
            }
        }

        return $result;
    }
}
