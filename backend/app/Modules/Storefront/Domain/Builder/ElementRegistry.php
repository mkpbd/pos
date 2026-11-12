<?php

namespace App\Modules\Storefront\Domain\Builder;

use App\Modules\Storefront\Domain\SectionType;
use App\Modules\Storefront\Domain\ThemeSchema;

/**
 * The store builder's element types (B1, plan §5): their group, label, props defaults,
 * translatable props and allowed children. Layout and content elements are defined here;
 * every homepage SectionType is also an element ("wrapped section") with props
 * `{title, subtitle, config, items}` and the section type's config rules, so it keeps its
 * storefront component and data source. The storefront mirrors this in `builder/registry.ts`.
 */
final class ElementRegistry
{
    /** B4: `site` holds the header / footer parts (logo, menu, cart, …). */
    public const GROUPS = ['layout', 'content', 'commerce', 'marketing', 'site'];

    /** Elements defined by the builder itself (not homepage section types). */
    public const BASIC = ['heading', 'text', 'image', 'button', 'spacer', 'divider', 'inner_row'];

    /** B4 elements (contract §2), defined by the builder itself too. */
    public const B4 = [
        'video', 'icon', 'countdown', 'discount', 'cta', 'search_box', 'promo_card',
        'logo', 'menu', 'account_link', 'wishlist_link', 'cart_icon', 'language_switch', 'announcement',
        'social_icons', 'payment_icons', 'contact_block', 'copyright', 'newsletter_form',
        'faq_list', 'contact_form', 'custom_html',
    ];

    /**
     * B4: the document contexts an element can be placed in: home / landing pages, CMS pages
     * (`cms:<uuid>`), the store header and footer, and the shop / product zones.
     */
    public const CONTEXTS = ['page', 'cms', 'header', 'footer', 'zone'];

    /**
     * B4: elements whose render payload carries `data[id]` (besides the wrapped sections); in a
     * published payload such an element without data is left out.
     */
    public const DATA_TYPES = ['countdown', 'discount', 'promo_card', 'menu', 'faq_list'];

    /** B4: elements the canvas resolver accepts besides wrapped sections (contact_form resolves to no data). */
    public const RESOLVABLE = [...self::DATA_TYPES, 'contact_form'];

    /**
     * B4: the storefront icon set (icon element `name`): the features-strip icons plus contact and
     * social glyphs. The storefront mirrors it (`builder/icons.tsx` ICON_NAMES).
     */
    public const ICONS = [
        ...SectionType::FEATURE_ICONS,
        'phone', 'mail', 'map-pin', 'instagram', 'facebook', 'youtube', 'check', 'sparkles',
    ];

    public const VIDEO_ASPECTS = ['16:9', '4:3', '1:1', '9:16'];

    public const VIDEO_PROVIDERS = ['youtube', 'vimeo'];

    /** Start offset of a video, seconds. */
    public const VIDEO_START = [0, 86400];

    public const VIDEO_URL_MAX = 500;

    public const ICON_SIZE = [16, 128];

    public const COUNTDOWN_SOURCES = ['date', 'promotion'];

    public const COUNTDOWN_STYLES = ['boxes', 'inline'];

    public const ALIGNS = ['left', 'center', 'right'];

    public const LOGO_HEIGHT = [24, 96];

    public const MENU_LAYOUTS = ['horizontal', 'vertical'];

    /** How a menu element shows sub-items, per document context. */
    public const MENU_CHILDREN = ['header' => ['none', 'dropdown', 'mega'], 'footer' => ['none', 'list']];

    public const LANGUAGE_SWITCH_STYLES = ['links', 'select'];

    public const SOCIAL_ICON_SIZE = [16, 48];

    public const SOCIAL_ICON_STYLES = ['plain', 'circle', 'square'];

    public const PAYMENT_ICON_HEIGHT = [16, 48];

    public const BLOCK_LAYOUTS = ['stacked', 'inline'];

    public const FAQ_STYLES = ['accordion', 'list'];

    public const CUSTOM_HTML_MAX = 20000;

    /**
     * B4: translatable props of the B4 elements with their maximum length (the base prop has the
     * same limit). `cta`'s button labels are nested props (see TRANSLATION_PATHS).
     */
    public const TRANSLATABLE = [
        'video' => ['title' => 200],
        'icon' => ['label' => 120],
        'countdown' => ['title' => 120, 'expired_text' => 200],
        'discount' => ['title' => 120, 'text' => 400, 'button_label' => 60],
        'cta' => ['title' => 120, 'text' => 400, 'primary.label' => 60, 'secondary.label' => 60],
        'search_box' => ['placeholder' => 80, 'button_label' => 30],
        'promo_card' => ['badge' => 24, 'title' => 120, 'text' => 200, 'button_label' => 30],
        'copyright' => ['text' => 200],
        'newsletter_form' => ['title' => 120, 'text' => 300, 'button_label' => 40],
        'faq_list' => ['title' => 120],
        'contact_form' => ['title' => 120],
    ];

    /** Translatable fields stored in a nested prop (dot keys in `translations`): field => [prop, key]. */
    public const TRANSLATION_PATHS = [
        'cta' => ['primary.label' => ['primary', 'label'], 'secondary.label' => ['secondary', 'label']],
    ];

    public const HEADING_LEVELS = [1, 6];

    public const IMAGE_ASPECTS = ['auto', '1:1', '4:3', '3:2', '16:9', '3:4'];

    public const IMAGE_FITS = ['cover', 'contain'];

    public const BUTTON_VARIANTS = ['primary', 'accent', 'outline', 'link'];

    public const BUTTON_SIZES = ['sm', 'md', 'lg'];

    public const DIVIDER_LINES = ['solid', 'dashed', 'dotted'];

    public const DIVIDER_ALIGNS = ['left', 'center', 'right'];

    public const DIVIDER_THICKNESS = [1, 10];

    public const DIVIDER_WIDTH = [10, 100];

    /** Text limits of the basic elements' props (characters). */
    public const TEXT_LIMITS = ['heading.text' => 200, 'text.html' => 20000, 'button.label' => 60, 'image.alt' => 200];

    /** Props holding rich text (sanitized with the HtmlSanitizer on save; B4: custom HTML too). */
    public const HTML_PROPS = ['text' => ['html'], 'rich_text' => ['body_html'], 'custom_html' => ['html']];

    /**
     * @return list<string>
     */
    public static function types(): array
    {
        return [...self::BASIC, ...array_map(fn (SectionType $t) => $t->value, SectionType::cases()), ...self::B4];
    }

    public static function exists(mixed $type): bool
    {
        return is_string($type) && in_array($type, self::types(), true);
    }

    /**
     * The homepage section type an element wraps, or null for basic and B4 elements.
     */
    public static function sectionType(string $type): ?SectionType
    {
        return in_array($type, self::BASIC, true) || in_array($type, self::B4, true) ? null : SectionType::tryFrom($type);
    }

    /**
     * B4: whether the element has `data[id]` in a render payload (wrapped sections and DATA_TYPES).
     */
    public static function hasData(string $type): bool
    {
        return in_array($type, self::DATA_TYPES, true) || self::sectionType($type) !== null;
    }

    /**
     * B4: the document contexts the element may be used in (contract §1: page set, header set,
     * footer set; FAQ list and contact form on CMS pages only).
     *
     * @return list<string>
     */
    public static function allowedIn(string $type): array
    {
        return match ($type) {
            'inner_row', 'heading', 'text', 'button', 'icon', 'image', 'divider', 'spacer',
            'social_icons', 'contact_block', 'custom_html' => self::CONTEXTS,
            'search_box' => ['page', 'cms', 'zone', 'header'],
            'payment_icons', 'newsletter_form' => ['page', 'cms', 'zone', 'footer'],
            'logo', 'menu', 'language_switch' => ['header', 'footer'],
            'account_link', 'wishlist_link', 'cart_icon', 'announcement' => ['header'],
            'copyright' => ['footer'],
            'faq_list', 'contact_form' => ['cms'],
            // Wrapped sections and the other B4 page elements.
            default => ['page', 'cms', 'zone'],
        };
    }

    public static function group(string $type): string
    {
        return match ($type) {
            'spacer', 'divider', 'inner_row' => 'layout',
            'heading', 'text', 'image', 'button', 'rich_text', 'blog_posts',
            'video', 'icon', 'cta', 'custom_html', 'faq_list', 'contact_form' => 'content',
            'product_carousel', 'product_grid', 'product_tabs', 'category_strip', 'brand_strip', 'search_box', 'promo_card' => 'commerce',
            'logo', 'menu', 'account_link', 'wishlist_link', 'cart_icon', 'language_switch', 'announcement',
            'social_icons', 'payment_icons', 'contact_block', 'copyright' => 'site',
            default => 'marketing',
        };
    }

    public static function label(string $type): string
    {
        return match ($type) {
            'heading' => 'Heading',
            'text' => 'Text',
            'image' => 'Image',
            'button' => 'Button',
            'spacer' => 'Spacer',
            'divider' => 'Divider',
            'inner_row' => 'Inner row',
            'video' => 'Video',
            'icon' => 'Icon',
            'countdown' => 'Countdown',
            'discount' => 'Discount',
            'cta' => 'Call to action',
            'search_box' => 'Search box',
            'promo_card' => 'Promoted product',
            'logo' => 'Logo',
            'menu' => 'Menu',
            'account_link' => 'Account',
            'wishlist_link' => 'Wishlist',
            'cart_icon' => 'Cart',
            'language_switch' => 'Language switch',
            'announcement' => 'Announcement',
            'social_icons' => 'Social icons',
            'payment_icons' => 'Payment icons',
            'contact_block' => 'Contact details',
            'copyright' => 'Copyright',
            'newsletter_form' => 'Newsletter form',
            'faq_list' => 'FAQ list',
            'contact_form' => 'Contact form',
            'custom_html' => 'Custom HTML',
            default => SectionType::from($type)->label(),
        };
    }

    /**
     * B4: `{provider, video_id}` of a supported video URL — YouTube `youtube.com/watch?v=`,
     * `youtu.be/`, `youtube.com/shorts/` (id 6–20 of `[A-Za-z0-9_-]`) or Vimeo `vimeo.com/<digits>`
     * — or null.
     *
     * @return array{provider: string, video_id: string}|null
     */
    public static function parseVideoUrl(mixed $url): ?array
    {
        if (! is_string($url) || mb_strlen($url) > self::VIDEO_URL_MAX) {
            return null;
        }
        $patterns = [
            'youtube' => [
                '#^https?://(?:www\.|m\.)?youtube\.com/watch\?(?:[^\s\#]*&)?v=([A-Za-z0-9_-]{6,20})(?:[&\#][^\s]*)?$#',
                '#^https?://youtu\.be/([A-Za-z0-9_-]{6,20})(?:[?\#][^\s]*)?$#',
                '#^https?://(?:www\.|m\.)?youtube\.com/shorts/([A-Za-z0-9_-]{6,20})(?:[?\#][^\s]*)?$#',
            ],
            'vimeo' => ['#^https?://(?:www\.)?vimeo\.com/(\d{1,20})(?:[/?\#][^\s]*)?$#'],
        ];
        foreach ($patterns as $provider => $list) {
            foreach ($list as $pattern) {
                if (preg_match($pattern, $url, $m) === 1) {
                    return ['provider' => $provider, 'video_id' => $m[1]];
                }
            }
        }

        return null;
    }

    /**
     * Child collection of the element (`columns` for an inner row), or null.
     */
    public static function children(string $type): ?string
    {
        return $type === 'inner_row' ? 'columns' : null;
    }

    /**
     * Translatable props with their maximum length.
     *
     * @return array<string, int>
     */
    public static function translatable(string $type): array
    {
        if (isset(self::TRANSLATABLE[$type])) {
            return self::TRANSLATABLE[$type];
        }
        $sectionType = self::sectionType($type);
        if ($sectionType === null) {
            $result = [];
            foreach (self::TEXT_LIMITS as $key => $max) {
                [$element, $prop] = explode('.', $key);
                if ($element === $type) {
                    $result[$prop] = $max;
                }
            }

            return $result;
        }

        $result = [];
        foreach ($sectionType->translatable() as $field => $rules) {
            $max = 255;
            foreach ($rules as $rule) {
                if (is_string($rule) && str_starts_with($rule, 'max:')) {
                    $max = (int) substr($rule, 4);
                }
            }
            $result[$field] = $max;
        }

        return $result;
    }

    /**
     * The props a new element starts with (every key normalize keeps).
     *
     * @return array<string, mixed>
     */
    public static function defaults(string $type): array
    {
        return match ($type) {
            'heading' => ['text' => 'Heading', 'level' => 2, 'link' => null],
            'text' => ['html' => '<p>Write something here.</p>'],
            'image' => ['media_id' => null, 'alt' => '', 'link' => null, 'aspect' => 'auto', 'fit' => 'cover'],
            'button' => ['label' => 'Shop now', 'link' => ['url' => '/shop'], 'variant' => 'primary', 'size' => 'md', 'full_width' => false],
            'spacer', 'inner_row' => [],
            'divider' => ['line' => 'solid', 'thickness' => 1, 'width' => 100, 'color' => 'theme:border', 'align' => 'center'],
            // B4. Video, countdown, discount, promoted product, menu and custom HTML need content
            // before they are valid (the editor's setup dialog).
            'video' => ['url' => '', 'provider' => 'youtube', 'video_id' => '', 'title' => '', 'aspect' => '16:9', 'autoplay' => false, 'start' => 0],
            'icon' => ['name' => 'star', 'size' => 32, 'color' => null, 'label' => '', 'link' => null],
            'countdown' => ['source' => 'date', 'ends_at' => null, 'promotion_id' => null, 'title' => '', 'expired_text' => '', 'style' => 'boxes'],
            'discount' => ['promotion_id' => null, 'title' => '', 'text' => '', 'show_code' => true, 'button_label' => 'Shop now', 'link' => ['url' => '/shop']],
            'cta' => [
                'title' => 'Ready when you are',
                'text' => '',
                'primary' => ['label' => 'Shop now', 'link' => ['url' => '/shop']],
                'secondary' => null,
                'align' => 'center',
            ],
            'search_box' => ['placeholder' => 'Search products', 'button_label' => ''],
            'promo_card' => ['product_id' => null, 'badge' => '', 'title' => null, 'text' => '', 'button_label' => 'Shop now'],
            'logo' => ['height' => 48, 'link' => ['url' => '/']],
            'menu' => ['menu_id' => null, 'layout' => 'horizontal', 'show_children' => 'dropdown'],
            'account_link', 'wishlist_link' => ['show_label' => false],
            'cart_icon' => ['show_count' => true, 'show_total' => false],
            'language_switch' => ['style' => 'links'],
            'announcement' => [],
            'social_icons' => ['size' => 24, 'style' => 'plain', 'color' => null],
            'payment_icons' => ['height' => 24],
            'contact_block' => ['show_phone' => true, 'show_email' => true, 'show_address' => true, 'layout' => 'stacked'],
            'copyright' => ['text' => null],
            'newsletter_form' => ['title' => 'Join our newsletter', 'text' => '', 'button_label' => 'Subscribe', 'layout' => 'inline'],
            'faq_list' => ['title' => null, 'style' => 'accordion'],
            'contact_form' => ['title' => null, 'show_details' => true],
            'custom_html' => ['html' => ''],
            default => ['title' => null, 'subtitle' => null, 'config' => SectionType::from($type)->defaults(), 'items' => []],
        };
    }

    /**
     * Registry metadata for the editor (GET /storefront/builder/elements).
     *
     * @return array<string, mixed>
     */
    public static function metadata(): array
    {
        return [
            'types' => array_map(fn (string $type) => [
                'type' => $type,
                'group' => self::group($type),
                'label' => self::label($type),
                'translatable' => array_keys(self::translatable($type)),
                'props' => (object) self::defaults($type),
                'children' => self::children($type),
                // B4: the document contexts it may be used in.
                'allowed_in' => self::allowedIn($type),
                'has_data' => self::hasData($type),
            ], self::types()),
            'limits' => [
                'sections' => BuilderDocumentSchema::MAX_SECTIONS,
                'nodes' => BuilderDocumentSchema::MAX_NODES,
                'bytes' => BuilderDocumentSchema::MAX_BYTES,
                'columns' => ['min' => 1, 'max' => BuilderDocumentSchema::MAX_COLUMNS],
                'elements_per_column' => BuilderDocumentSchema::MAX_ELEMENTS_PER_COLUMN,
                'column_width' => ['min' => BuilderDocumentSchema::COLUMN_WIDTH[0], 'max' => BuilderDocumentSchema::COLUMN_WIDTH[1]],
                'inner_row_depth' => 1,
                'text' => self::TEXT_LIMITS,
                'section_title' => 120,
                'section_subtitle' => 255,
                'heading_level' => ['min' => self::HEADING_LEVELS[0], 'max' => self::HEADING_LEVELS[1]],
                'divider_thickness' => ['min' => self::DIVIDER_THICKNESS[0], 'max' => self::DIVIDER_THICKNESS[1]],
                'divider_width' => ['min' => self::DIVIDER_WIDTH[0], 'max' => self::DIVIDER_WIDTH[1]],
                'shadows' => StyleSchema::MAX_SHADOWS,
                'text_shadows' => StyleSchema::MAX_TEXT_SHADOWS,
                'gradient_stops' => StyleSchema::GRADIENT_STOPS,
                'length_bounds' => StyleSchema::UNIT_BOUNDS,
                'border_width_px' => 20,
                'shadow' => ['x' => [-100, 100], 'y' => [-100, 100], 'blur' => [0, 200], 'spread' => [-100, 100]],
                'line_height' => [0.8, 3],
                'id_pattern' => BuilderDocumentSchema::ID_PATTERN,
                'anchor_pattern' => BuilderDocumentSchema::ANCHOR_PATTERN,
                'items' => array_filter(array_combine(
                    array_map(fn (SectionType $t) => $t->value, SectionType::cases()),
                    array_map(fn (SectionType $t) => self::itemLimits($t), SectionType::cases()),
                )),
                // B4 element limits.
                'translatable' => self::TRANSLATABLE,
                'video_url' => self::VIDEO_URL_MAX,
                'video_start' => ['min' => self::VIDEO_START[0], 'max' => self::VIDEO_START[1]],
                'icon_size' => ['min' => self::ICON_SIZE[0], 'max' => self::ICON_SIZE[1]],
                'logo_height' => ['min' => self::LOGO_HEIGHT[0], 'max' => self::LOGO_HEIGHT[1]],
                'social_icon_size' => ['min' => self::SOCIAL_ICON_SIZE[0], 'max' => self::SOCIAL_ICON_SIZE[1]],
                'payment_icon_height' => ['min' => self::PAYMENT_ICON_HEIGHT[0], 'max' => self::PAYMENT_ICON_HEIGHT[1]],
                'custom_html' => self::CUSTOM_HTML_MAX,
            ],
            'enums' => [
                'section_layouts' => BuilderDocumentSchema::SECTION_LAYOUTS,
                'breakpoints' => StyleSchema::BREAKPOINTS,
                'devices' => BuilderDocumentSchema::DEVICES,
                'groups' => self::GROUPS,
                'theme_colors' => array_map(fn (string $c) => 'theme:'.$c, ThemeSchema::COLORS),
                'fonts' => StyleSchema::FONTS,
                'units' => StyleSchema::UNITS,
                'text_aligns' => StyleSchema::TEXT_ALIGNS,
                'text_transforms' => StyleSchema::TEXT_TRANSFORMS,
                'background_types' => StyleSchema::BACKGROUND_TYPES,
                'background_positions' => StyleSchema::BACKGROUND_POSITIONS,
                'background_sizes' => StyleSchema::BACKGROUND_SIZES,
                'gradient_types' => StyleSchema::GRADIENT_TYPES,
                'gradient_shapes' => StyleSchema::GRADIENT_SHAPES,
                'layout_aligns' => StyleSchema::LAYOUT_ALIGNS,
                'layout_justify' => StyleSchema::LAYOUT_JUSTIFY,
                'border_styles' => StyleSchema::BORDER_STYLES,
                'hover_transforms' => StyleSchema::HOVER_TRANSFORMS,
                'image_aspects' => self::IMAGE_ASPECTS,
                'image_fits' => self::IMAGE_FITS,
                'button_variants' => self::BUTTON_VARIANTS,
                'button_sizes' => self::BUTTON_SIZES,
                'divider_lines' => self::DIVIDER_LINES,
                'divider_aligns' => self::DIVIDER_ALIGNS,
                'node_states' => ['hidden', 'scheduled', 'expired', 'empty'],
                'product_sources' => SectionType::PRODUCT_SOURCES,
                'category_strip_sources' => SectionType::CATEGORY_STRIP_SOURCES,
                'brand_strip_sources' => SectionType::BRAND_STRIP_SOURCES,
                'banner_grid_layouts' => SectionType::BANNER_GRID_LAYOUTS,
                'feature_icons' => SectionType::FEATURE_ICONS,
                'grid_columns' => SectionType::GRID_COLUMNS,
                // B4.
                'contexts' => self::CONTEXTS,
                'icons' => self::ICONS,
                'video_aspects' => self::VIDEO_ASPECTS,
                'video_providers' => self::VIDEO_PROVIDERS,
                'countdown_sources' => self::COUNTDOWN_SOURCES,
                'countdown_styles' => self::COUNTDOWN_STYLES,
                'aligns' => self::ALIGNS,
                'menu_layouts' => self::MENU_LAYOUTS,
                'menu_children' => self::MENU_CHILDREN,
                'language_switch_styles' => self::LANGUAGE_SWITCH_STYLES,
                'social_icon_styles' => self::SOCIAL_ICON_STYLES,
                'block_layouts' => self::BLOCK_LAYOUTS,
                'faq_styles' => self::FAQ_STYLES,
            ],
        ];
    }

    /**
     * What a wrapped section's `items` may hold: banners of a placement, or hand-picked
     * products / categories / brands (only while the config's source is `manual`).
     *
     * @return array{item_type: string, min: int, max: int, placement?: string, when?: string}|null
     */
    public static function itemLimits(SectionType $type): ?array
    {
        if (($limits = $type->itemLimits()) !== null) {
            return ['item_type' => 'banner', ...$limits, 'placement' => $type->bannerPlacement()?->value];
        }
        if (($manual = $type->manualItemLimits()) !== null) {
            return ['item_type' => $manual['type'], 'min' => $manual['min'], 'max' => $manual['max'], 'when' => 'source=manual'];
        }

        return null;
    }
}
