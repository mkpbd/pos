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
    public const HEADING_FONTS = ['baloo', 'poppins', 'playfair', 'jost', 'system'];

    public const BODY_FONTS = ['poppins', 'jost', 'system'];

    public const BUTTON_STYLES = ['pill', 'rounded', 'square'];

    /** T1: the look the theme started from (ThemePresets); every value stays editable. */
    public const PRESETS = ['default', 'vegan', 'handmade', 'classic', 'kids'];

    // T1: layout variants. The first of each list is today's look (the default).
    public const HEADER_STYLES = ['standard', 'centered', 'commerce'];

    public const FOOTER_STYLES = ['columns', 'showcase', 'widgets'];

    /** K1: `arched` — white image area over a primary-coloured caption block with an arched top edge (kids). */
    public const CARD_STYLES = ['standard', 'minimal', 'commerce', 'arched'];

    public const HERO_STYLES = ['full', 'tiles', 'sale'];

    public const HEADING_CASES = ['normal', 'lowercase', 'uppercase'];

    public const TOP_BARS = ['none', 'ticker', 'utility'];

    public const SOCIAL_NETWORKS = ['facebook', 'instagram', 'youtube', 'tiktok', 'x', 'linkedin'];

    /**
     * B4: products per row on shop, category, brand and search listings, per device (desktop
     * ≥ 1024 px, tablet 768–1023 px, mobile < 768 px). The defaults are today's grid
     * (`grid-cols-2 md:grid-cols-3`: 2 on phones, 3 from 768 px up). Owner content: applying a
     * preset keeps it.
     */
    public const LISTING_COLUMNS = ['desktop' => [3, 4, 5], 'tablet' => [2, 3, 4], 'mobile' => [1, 2]];

    public const LISTING_COLUMNS_DEFAULT = ['desktop' => 3, 'tablet' => 3, 'mobile' => 2];

    /**
     * P1b: the product page layout — gallery on the left or right, thumbnails below the photo or
     * in a strip beside it (desktop; below on phones), the summary column sticking while the
     * gallery scrolls (desktop), and the details as tabs, an accordion or stacked sections. The
     * first choice of each (and `sticky_summary` false) is today's page. Owner content like
     * `listing_columns`: applying a preset keeps it.
     */
    public const PRODUCT_LAYOUT = [
        'gallery' => ['left', 'right'],
        'thumbnails' => ['bottom', 'side'],
        'details' => ['tabs', 'accordion', 'stacked'],
    ];

    public const PRODUCT_LAYOUT_DEFAULT = ['gallery' => 'left', 'thumbnails' => 'bottom', 'sticky_summary' => false, 'details' => 'tabs'];

    /**
     * The base colour roles (always `#rrggbb`). They are also the `theme:<role>` colour tokens of
     * store builder styles (StyleSchema; mirrored by the editor), so this list only grows together
     * with the builder's token list.
     */
    public const COLORS = ['primary', 'primary_foreground', 'accent', 'accent_foreground', 'highlight', 'sale', 'heading', 'text', 'canvas', 'surface', 'border'];

    /**
     * B3: colour roles that start as a copy of another role — a theme saved without them gets
     * that role's value, so it keeps looking exactly as before (buttons were painted in the
     * primary colour pair, links in the accent). Always `#rrggbb` once normalized.
     */
    public const DERIVED_COLORS = ['button' => 'primary', 'button_foreground' => 'primary_foreground', 'link' => 'accent'];

    /**
     * B3: colour roles where null means "automatic": `button_hover` null keeps today's hover
     * effect (the button colour, slightly brightened by a CSS filter).
     */
    public const AUTO_COLORS = ['button_hover'];

    /** B3: the store's own saved colours (`palette`: [{name, hex}]), offered in every colour picker. */
    public const MAX_PALETTE = 8;

    public const MAX_PALETTE_NAME = 40;

    /**
     * B3: type scale bounds [min, max] (validated by the request; heading weights in steps of 100).
     *
     * - `body_size`: body text size in px (the root size, rem = this)
     * - `heading_scale`: ratio between heading levels (h4 = body x scale, h3 = h4 x scale, ...)
     * - `line_height`: body text line height (unitless)
     * - `heading_weight`: heading font weight
     * - `mobile_scale`: factor for heading sizes below 640 px
     * - `letter_spacing`: extra heading letter spacing in em (added to uppercase headings' 0.04em)
     */
    public const TYPE_SCALE = [
        'body_size' => [13, 20],
        'heading_scale' => [1.1, 1.5],
        'line_height' => [1.3, 1.9],
        'heading_weight' => [400, 900],
        'mobile_scale' => [0.8, 1.0],
        'letter_spacing' => [-0.02, 0.1],
    ];

    /** The integer type scale keys (the others are decimals). */
    private const INTEGER_TYPE_KEYS = ['body_size', 'heading_weight'];

    /**
     * Every colour role key in document order.
     *
     * @return list<string>
     */
    public static function colorKeys(): array
    {
        return [...self::COLORS, ...array_keys(self::DERIVED_COLORS), ...self::AUTO_COLORS];
    }

    public const MAX_PAYMENT_LOGOS = 10;

    /**
     * @return array<string, mixed>
     */
    public static function defaults(): array
    {
        return [
            'preset' => 'default',
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
                // B3 (DERIVED_COLORS / AUTO_COLORS): today's buttons and links.
                'button' => '#f59e0b',
                'button_foreground' => '#3b2500',
                'link' => '#6f55c2',
                'button_hover' => null,
            ],
            'typography' => [
                'heading_font' => 'baloo',
                'body_font' => 'poppins',
                // B3 type scale (TYPE_SCALE): the defaults reproduce today's storefront sizes.
                'body_size' => 16,
                'heading_scale' => 1.25,
                'line_height' => 1.5,
                'heading_weight' => 700,
                // Whole numbers are stored as integers (JSON has one number type).
                'mobile_scale' => 1,
                'letter_spacing' => 0,
            ],
            // B3: the store's saved colours [{name, hex}] (content: presets keep it).
            'palette' => [],
            'shape' => ['button_style' => 'pill', 'card_radius' => 12],
            'layout' => [
                'container_width' => 1170,
                'sticky_header' => true,
                'header_style' => self::HEADER_STYLES[0],
                'footer_style' => self::FOOTER_STYLES[0],
                'card_style' => self::CARD_STYLES[0],
                'hero_style' => self::HERO_STYLES[0],
                'heading_case' => self::HEADING_CASES[0],
                'top_bar' => self::TOP_BARS[0],
                // B4: products per row on listings (LISTING_COLUMNS).
                'listing_columns' => self::LISTING_COLUMNS_DEFAULT,
                // P1b: the product page layout (PRODUCT_LAYOUT).
                'product' => self::PRODUCT_LAYOUT_DEFAULT,
            ],
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
                // E12b: {"bn": {"text": "…"}} or null.
                'translations' => null,
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
        $result = self::merge(self::defaults(), $settings);

        // B3: a missing (or null) derived role copies its source role of this theme.
        $colors = is_array($settings['colors'] ?? null) ? $settings['colors'] : [];
        foreach (self::DERIVED_COLORS as $key => $source) {
            if (! isset($colors[$key]) && is_array($result['colors'])) {
                $result['colors'][$key] = $result['colors'][$source];
            }
        }

        if (is_array($result['typography'])) {
            foreach (self::TYPE_SCALE as $key => $bounds) {
                $value = $result['typography'][$key] ?? null;
                if (is_int($value) || is_float($value) || (is_string($value) && is_numeric($value))) {
                    $number = round((float) $value, in_array($key, self::INTEGER_TYPE_KEYS, true) ? 0 : 3);
                    // One form per value whatever the storage (json_encode writes 1.0 as 1): whole numbers are ints.
                    $result['typography'][$key] = floor($number) === $number ? (int) $number : $number;
                }
            }
        }

        $result['palette'] = self::palette($result['palette']);

        // B4: whole numbers (a stored "4" reads as 4); values outside a device's choices fall back to the default.
        if (is_array($result['layout']) && is_array($result['layout']['listing_columns'] ?? null)) {
            foreach (self::LISTING_COLUMNS as $device => $choices) {
                $value = $result['layout']['listing_columns'][$device] ?? null;
                $value = is_int($value) || (is_string($value) && ctype_digit($value)) ? (int) $value : null;
                $result['layout']['listing_columns'][$device] = in_array($value, $choices, true) ? $value : self::LISTING_COLUMNS_DEFAULT[$device];
            }
        }

        // P1b: a value outside its choices falls back to today's layout; `sticky_summary` is a real boolean.
        if (is_array($result['layout'])) {
            $product = is_array($result['layout']['product'] ?? null) ? $result['layout']['product'] : [];
            $layout = [];
            foreach (self::PRODUCT_LAYOUT_DEFAULT as $key => $default) {
                $value = $product[$key] ?? null;
                $layout[$key] = match (true) {
                    $key === 'sticky_summary' => is_bool($value) ? $value : (in_array($value, [1, '1', 'true'], true) ? true : $default),
                    default => in_array($value, self::PRODUCT_LAYOUT[$key], true) ? $value : $default,
                };
            }
            $result['layout']['product'] = $layout;
        }

        return $result;
    }

    /**
     * B3: whether two theme documents are the same theme once normalized (map key order and
     * stored number forms do not matter: jsonb reorders keys).
     *
     * @param  array<string, mixed>  $a
     * @param  array<string, mixed>  $b
     */
    public static function same(array $a, array $b): bool
    {
        return self::canonical(self::normalize($a)) === self::canonical(self::normalize($b));
    }

    private static function canonical(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        $value = array_map(fn ($v) => self::canonical($v), $value);
        if (! array_is_list($value)) {
            ksort($value);
        }

        return $value;
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
     * Palette entries as `{name, hex}` (other keys dropped, hex lower-cased); entries that are
     * not well-formed are left out.
     *
     * @return list<array{name: string, hex: string}>
     */
    private static function palette(mixed $palette): array
    {
        if (! is_array($palette)) {
            return [];
        }
        $entries = [];
        foreach ($palette as $entry) {
            if (is_array($entry) && is_string($entry['name'] ?? null) && is_string($entry['hex'] ?? null)) {
                $entries[] = ['name' => trim($entry['name']), 'hex' => strtolower($entry['hex'])];
            }
        }

        return $entries;
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
