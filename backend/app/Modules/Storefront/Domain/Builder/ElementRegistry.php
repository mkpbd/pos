<?php

namespace App\Modules\Storefront\Domain\Builder;

use App\Modules\Shared\Domain\VideoUrl;
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
    /** B4: `site` holds the header / footer parts (logo, menu, cart, …); B6: `media` the galleries, carousels and map. */
    public const GROUPS = ['layout', 'content', 'media', 'commerce', 'marketing', 'site'];

    /** Elements defined by the builder itself (not homepage section types). */
    public const BASIC = ['heading', 'text', 'image', 'button', 'spacer', 'divider', 'inner_row'];

    /** B4 elements (contract §2), defined by the builder itself too. */
    public const B4 = [
        'video', 'icon', 'countdown', 'discount', 'cta', 'search_box', 'promo_card',
        'logo', 'menu', 'account_link', 'wishlist_link', 'cart_icon', 'language_switch', 'announcement',
        'social_icons', 'payment_icons', 'contact_block', 'copyright', 'newsletter_form',
        'faq_list', 'contact_form', 'custom_html',
    ];

    /** B6 elements (content blocks, media, shop-focused, motion and the chart), defined by the builder too. */
    public const B6 = [
        'accordion', 'tabs', 'icon_box', 'icon_list', 'quote', 'notice', 'counter', 'steps', 'chart',
        'gallery', 'image_carousel', 'logo_carousel', 'map',
        'category_card', 'product_spotlight', 'shop_the_look', 'trust_badges', 'recently_viewed',
        'marquee',
    ];

    /** B8a elements (selling blocks, trust & people, visualization), defined by the builder too. */
    public const B8A = [
        'pricing_table', 'before_after', 'comparison_table', 'flash_sale_bar', 'bundle',
        'team', 'review_wall', 'photo_grid', 'store_hours',
        'progress_bars',
    ];

    /** B8b: the form builder element (pages, content pages, shop areas and popups). */
    public const B8B = ['form'];

    /** P2a: the one-product order form of landing pages (pages, content pages and shop areas). */
    public const P2A = ['order_form'];

    /** P2a: whether the order form asks for an e-mail address / a note. */
    public const ORDER_FORM_EMAIL = ['hidden', 'optional', 'required'];

    public const ORDER_FORM_NOTE = ['hidden', 'optional'];

    /** P2a: `cod_only` — cash on delivery only; `store_methods` — the store's enabled methods. */
    public const ORDER_FORM_PAYMENT = ['cod_only', 'store_methods'];

    /** P2a: the order form's preselected quantity and its largest quantity. */
    public const ORDER_FORM_QUANTITY_DEFAULT = [1, 10];

    public const ORDER_FORM_QUANTITY_MAX = [1, 20];

    /**
     * B4: the document contexts an element can be placed in: home / landing pages, CMS pages
     * (`cms:<uuid>`), the store header and footer, and the shop / product zones. B8b: popups and
     * bars (`popup:<uuid>`).
     */
    public const CONTEXTS = ['page', 'cms', 'header', 'footer', 'zone', 'popup'];

    /**
     * B8b: the elements a popup or bar may hold (basics, calls to action, offers, the newsletter
     * and the form — no shop grids, sliders, charts, maps or header / footer parts).
     */
    public const POPUP_ELEMENTS = [
        'heading', 'text', 'image', 'button', 'icon', 'divider', 'spacer', 'inner_row',
        'cta', 'discount', 'countdown', 'newsletter_form', 'notice', 'icon_list', 'marquee',
        'video', 'social_icons', 'payment_icons', 'custom_html', 'form',
    ];

    /** B8b: a button's optional action (`link` is the default and is not stored). */
    public const BUTTON_ACTIONS = ['link', 'dismiss'];

    /** B8b: form field kinds (no file uploads). */
    public const FORM_FIELD_KINDS = ['text', 'email', 'phone', 'textarea', 'number', 'select', 'radio', 'checkbox', 'checkboxes', 'date'];

    /** B8b: field kinds with options. */
    public const FORM_CHOICE_KINDS = ['select', 'radio', 'checkboxes'];

    public const FORM_LAYOUTS = ['stacked', 'two_columns'];

    /** B8b: a text / textarea field's maximum length (and the default when not set). */
    public const FORM_MAX_LENGTH = [1, 2000];

    public const FORM_DEFAULT_MAX_LENGTH = ['text' => 255, 'textarea' => 2000];

    /** B8b: a number field's min / max bounds (absolute), at most 2 decimals. */
    public const FORM_NUMBER_BOUND = 1000000000;

    /** B8b: text limits of the form element's fields, options and consent. */
    public const B8B_TEXT_LIMITS = [
        'form.fields.label' => 80, 'form.fields.placeholder' => 80, 'form.fields.help' => 160,
        'form.fields.options.label' => 60, 'form.consent.text' => 300, 'form.notify_email' => 254,
    ];

    /**
     * B4: elements whose render payload carries `data[id]` (besides the wrapped sections); in a
     * published payload such an element without data is left out.
     */
    public const DATA_TYPES = [
        'countdown', 'discount', 'promo_card', 'menu', 'faq_list', 'category_card', 'product_spotlight', 'shop_the_look',
        // B8a.
        'comparison_table', 'flash_sale_bar', 'bundle', 'review_wall', 'store_hours',
        // P2a.
        'order_form',
    ];

    /**
     * B4: elements the canvas resolver accepts besides wrapped sections (contact_form resolves
     * to no data; B8a: a chart has data only with a store `data_source`).
     */
    public const RESOLVABLE = [...self::DATA_TYPES, 'contact_form', 'chart'];

    /**
     * B4: the storefront icon set (icon element `name`): the features-strip icons plus contact and
     * social glyphs. The storefront mirrors it (`builder/icons.tsx` ICON_NAMES).
     */
    public const ICONS = [
        ...SectionType::FEATURE_ICONS,
        'phone', 'mail', 'map-pin', 'instagram', 'facebook', 'youtube', 'check', 'sparkles',
    ];

    public const VIDEO_ASPECTS = ['16:9', '4:3', '1:1', '9:16'];

    public const VIDEO_PROVIDERS = VideoUrl::PROVIDERS;

    /** Start offset of a video, seconds. */
    public const VIDEO_START = [0, 86400];

    public const VIDEO_URL_MAX = VideoUrl::MAX_LENGTH;

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
     * B6: the length of every repeatable list (min, max): `<element>.<list prop>`.
     */
    public const LIST_LIMITS = [
        'accordion.items' => [1, 20],
        'tabs.items' => [2, 8],
        'icon_list.items' => [1, 20],
        'counter.items' => [1, 6],
        'steps.items' => [2, 8],
        'chart.labels' => [1, 24],
        'chart.series' => [1, 6],
        'gallery.images' => [1, 30],
        'image_carousel.images' => [1, 20],
        'logo_carousel.logos' => [2, 24],
        'shop_the_look.hotspots' => [1, 8],
        'trust_badges.items' => [1, 6],
        'marquee.items' => [1, 10],
        // B8a (nested lists: `<element>.<list>.<nested list>`).
        'pricing_table.plans' => [1, 4],
        'pricing_table.plans.features' => [0, 12],
        'comparison_table.columns' => [2, 4],
        'comparison_table.rows' => [1, 20],
        'bundle.items' => [2, 4],
        'team.members' => [1, 12],
        'team.members.links' => [0, 5],
        'photo_grid.images' => [3, 24],
        'store_hours.days' => [7, 7],
        'progress_bars.items' => [1, 10],
        // B8b.
        'form.fields' => [1, 20],
        'form.fields.options' => [2, 20],
    ];

    /**
     * B8a: text limits of the B8a elements' list item fields and nested props
     * (`<element>.<path>`, characters; translatable ones are in TRANSLATABLE /
     * LIST_TRANSLATABLE / NESTED_LIST_TRANSLATABLE too).
     */
    public const B8A_TEXT_LIMITS = [
        'pricing_table.plans.name' => 60, 'pricing_table.plans.price_text' => 24, 'pricing_table.plans.period' => 24,
        'pricing_table.plans.description' => 200, 'pricing_table.plans.badge' => 24, 'pricing_table.plans.button.label' => 30,
        'pricing_table.plans.features.text' => 120,
        'before_after.before.alt' => 200, 'before_after.after.alt' => 200,
        'comparison_table.columns.title' => 60, 'comparison_table.rows.label' => 80, 'comparison_table.rows.cells.text' => 60,
        'flash_sale_bar.button.label' => 30,
        'team.members.name' => 80, 'team.members.role' => 80, 'team.members.bio' => 300, 'team.members.links.url' => 255,
        'photo_grid.images.alt' => 200, 'photo_grid.profile.label' => 60,
        'progress_bars.items.label' => 60,
    ];

    /**
     * B8a: translatable fields in nested lists or in objects inside list items, as patterns
     * where `*` stands for an item id (or, in `cells`, a column id): the stored key replaces it
     * (`plans.p1.features.f2.text`, `rows.r1.cells.c2.text`, `plans.p1.button.label`).
     */
    public const NESTED_LIST_TRANSLATABLE = [
        'pricing_table' => ['plans.*.button.label' => 30, 'plans.*.features.*.text' => 120],
        'comparison_table' => ['rows.*.cells.*.text' => 60],
        // B8b.
        'form' => ['fields.*.options.*.label' => 60],
    ];

    /**
     * B6: text limits of the B6 elements' item fields and other texts that are not translatable
     * (`<element>.<list>.<field>` / `<element>.<prop>`, characters).
     */
    public const B6_TEXT_LIMITS = [
        'accordion.items.title' => 120, 'accordion.items.html' => 5000,
        'tabs.items.title' => 60, 'tabs.items.html' => 8000,
        'icon_list.items.text' => 160,
        'counter.items.prefix' => 4, 'counter.items.suffix' => 8, 'counter.items.label' => 60,
        'steps.items.title' => 80, 'steps.items.text' => 300,
        'chart.labels' => 40, 'chart.series.name' => 40, 'chart.unit' => 8,
        'gallery.images.alt' => 200, 'gallery.images.caption' => 200,
        'image_carousel.images.alt' => 200, 'image_carousel.images.caption' => 200,
        'logo_carousel.logos.alt' => 200,
        'trust_badges.items.title' => 60, 'trust_badges.items.text' => 120,
        'marquee.items.text' => 120,
    ];

    /**
     * B6: translatable fields of list items, per element and list prop, with their maximum length.
     * Translation keys are `<list>.<item id>.<field>` (e.g. `items.i2.title`, `images.g3.alt`,
     * `series.s1.name`); a key of an item that no longer exists is dropped on save.
     */
    public const LIST_TRANSLATABLE = [
        'accordion' => ['items' => ['title' => 120, 'html' => 5000]],
        'tabs' => ['items' => ['title' => 60, 'html' => 8000]],
        'icon_list' => ['items' => ['text' => 160]],
        'counter' => ['items' => ['suffix' => 8, 'label' => 60]],
        'steps' => ['items' => ['title' => 80, 'text' => 300]],
        'chart' => ['series' => ['name' => 40]],
        'gallery' => ['images' => ['alt' => 200, 'caption' => 200]],
        'image_carousel' => ['images' => ['alt' => 200, 'caption' => 200]],
        'logo_carousel' => ['logos' => ['alt' => 200]],
        'trust_badges' => ['items' => ['title' => 60, 'text' => 120]],
        'marquee' => ['items' => ['text' => 120]],
        // B8a.
        'pricing_table' => ['plans' => ['name' => 60, 'price_text' => 24, 'period' => 24, 'description' => 200, 'badge' => 24]],
        'comparison_table' => ['columns' => ['title' => 60], 'rows' => ['label' => 80]],
        'team' => ['members' => ['role' => 80, 'bio' => 300]],
        'photo_grid' => ['images' => ['alt' => 200]],
        'progress_bars' => ['items' => ['label' => 60]],
        // B8b.
        'form' => ['fields' => ['label' => 80, 'placeholder' => 80, 'help' => 160]],
    ];

    /**
     * B6: translatable lists of plain strings (no ids): keys are `<list>.<index>` (e.g. a chart's
     * category names `labels.0`, `labels.1`, …).
     */
    public const STRING_LIST_TRANSLATABLE = ['chart' => ['labels' => 40]];

    /** B6: rich text inside list items (sanitized with the HtmlSanitizer on save, translations too). */
    public const HTML_ITEM_PROPS = ['accordion' => ['items' => ['html']], 'tabs' => ['items' => ['html']]];

    public const ACCORDION_STYLES = ['plain', 'boxed'];

    public const TABS_LAYOUTS = ['horizontal', 'vertical'];

    public const ICON_BOX_LAYOUTS = ['top', 'left'];

    public const ICON_STYLES = ['plain', 'circle', 'square'];

    public const ICON_LIST_LAYOUTS = ['vertical', 'inline'];

    public const QUOTE_STYLES = ['plain', 'card', 'large'];

    public const NOTICE_TONES = ['info', 'success', 'warning', 'promo'];

    /** A counter's value: 0 … 1 000 000 000, at most 2 decimals. */
    public const COUNTER_VALUE = [0, 1000000000];

    public const STEPS_LAYOUTS = ['horizontal', 'vertical'];

    /** B8a: `stacked-column` and `stacked-bar` added. */
    public const CHART_KINDS = ['bar', 'column', 'line', 'area', 'pie', 'donut', 'stacked-column', 'stacked-bar'];

    /** B8a: stacked kinds take 2–6 series of non-negative values. */
    public const CHART_STACKED_KINDS = ['stacked-column', 'stacked-bar'];

    public const CHART_STACKED_SERIES = [2, 6];

    /**
     * B8a: where a chart's numbers come from — typed in (`manual`), or public-safe counts from
     * the store (rendered from `data[id]`, never sales, revenue, order or customer numbers).
     */
    public const CHART_DATA_SOURCES = ['manual', 'store.products_per_category', 'store.rating_breakdown'];

    /** B8a: a products-per-category chart shows at most this many categories (pie / donut: CHART_PIE_LABELS). */
    public const CHART_STORE_CATEGORIES = 12;

    /** Pie and donut charts: exactly one series and at most this many labels. */
    public const CHART_PIE_LABELS = 8;

    /** Largest absolute chart value. */
    public const CHART_VALUE_MAX = 1000000000000;

    public const CHART_UNIT_POSITIONS = ['before', 'after'];

    public const CHART_SHOW_VALUES = ['none', 'last', 'all-small'];

    public const CHART_HEIGHT = [200, 600];

    public const GALLERY_ASPECTS = ['square', '4:3', '3:4', '16:9', 'auto'];

    public const GALLERY_COLUMNS = ['base' => [2, 6], 'tablet' => [1, 6], 'mobile' => [1, 6]];

    public const GALLERY_GAPS = ['sm', 'md', 'lg'];

    /** Image carousel autoplay, seconds (0 = off). */
    public const CAROUSEL_AUTOPLAY = [0, 15];

    public const SPEEDS = ['slow', 'normal', 'fast'];

    public const MAP_HEIGHT = [200, 600];

    public const MAP_ZOOM = [3, 20];

    public const CATEGORY_CARD_LAYOUTS = ['overlay', 'below'];

    public const SPOTLIGHT_LAYOUTS = ['image-left', 'image-right'];

    public const TRUST_BADGE_STYLES = ['row', 'grid'];

    public const RECENTLY_VIEWED_LIMIT = [4, 12];

    public const MARQUEE_DIRECTIONS = ['left', 'right'];

    public const MARQUEE_SEPARATORS = ['dot', 'star', 'leaf', 'none'];

    /** B8a: a price (NUMERIC string, ≥ 0, at most 12 digits and 2 decimals). */
    public const MONEY_PATTERN = '^\d{1,12}(\.\d{1,2})?$';

    public const BEFORE_AFTER_ORIENTATIONS = ['horizontal', 'vertical'];

    public const BEFORE_AFTER_ASPECTS = ['1:1', '4:3', '3:2', '16:9'];

    /** B8a: the before / after handle's start position, percent. */
    public const BEFORE_AFTER_START = [0, 100];

    public const COMPARISON_CELL_KINDS = ['yes', 'no', 'text'];

    public const FLASH_SALE_STYLES = ['bar', 'card'];

    public const FLASH_SALE_PRODUCT_LIMIT = [2, 8];

    public const TEAM_COLUMNS = ['base' => [2, 4], 'tablet' => [1, 4], 'mobile' => [1, 4]];

    public const TEAM_STYLES = ['card', 'plain', 'circle'];

    /** B8a: a team member's links (email: `mailto:`; website: http(s); the others: https only). */
    public const TEAM_LINK_KINDS = ['facebook', 'instagram', 'linkedin', 'x', 'youtube', 'tiktok', 'website', 'email'];

    public const REVIEW_SOURCES = ['latest', 'top_rated', 'product'];

    public const REVIEW_LAYOUTS = ['grid', 'carousel'];

    public const REVIEW_MIN_RATING = [1, 5];

    public const REVIEW_LIMIT = [3, 12];

    /** B8a: a review's body in a review wall, characters (cut with an ellipsis). */
    public const REVIEW_BODY_MAX = 600;

    public const PHOTO_GRID_COLUMNS = ['base' => [3, 6], 'tablet' => [1, 6], 'mobile' => [1, 6]];

    public const PHOTO_GRID_GAPS = ['none', 'sm', 'md'];

    public const PHOTO_GRID_HOVERS = ['none', 'zoom', 'overlay'];

    /** B8a: store hours days, always stored in this order. */
    public const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

    public const WEEK_STARTS = ['sat', 'sun', 'mon'];

    /** B8a: an opening or closing time. */
    public const TIME_PATTERN = '^([01]\d|2[0-3]):[0-5]\d$';

    public const PROGRESS_STYLES = ['bar', 'ring'];

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
        // B6 (list items: LIST_TRANSLATABLE, chart labels: STRING_LIST_TRANSLATABLE).
        'icon_box' => ['title' => 120, 'text' => 400],
        'quote' => ['text' => 600, 'author' => 80, 'role' => 80],
        'notice' => ['title' => 120, 'text' => 400],
        'chart' => ['title' => 120, 'description' => 300],
        'map' => ['query' => 200, 'title' => 120],
        'category_card' => ['title' => 120, 'button_label' => 30],
        'product_spotlight' => ['badge' => 24],
        'shop_the_look' => ['alt' => 200, 'title' => 120],
        'recently_viewed' => ['title' => 120],
        // B8a (list items: LIST_TRANSLATABLE / NESTED_LIST_TRANSLATABLE; nested props: TRANSLATION_PATHS).
        'before_after' => ['before_label' => 24, 'after_label' => 24, 'before.alt' => 200, 'after.alt' => 200],
        'flash_sale_bar' => ['title' => 80, 'text' => 160, 'button.label' => 30],
        'bundle' => ['title' => 80, 'text' => 200, 'button_label' => 30],
        'review_wall' => ['title' => 120],
        'photo_grid' => ['profile.label' => 60],
        'store_hours' => ['title' => 80, 'note' => 200],
        // B8b (fields: LIST_TRANSLATABLE, options: NESTED_LIST_TRANSLATABLE).
        'form' => ['title' => 120, 'text' => 400, 'submit_label' => 30, 'success_message' => 300, 'consent.text' => 300],
        // P2a (`upsell.label` is a nested prop, see TRANSLATION_PATHS).
        'order_form' => ['title' => 120, 'text' => 400, 'button_label' => 60, 'success_message' => 400, 'upsell.label' => 120],
    ];

    /** Translatable fields stored in a nested prop (dot keys in `translations`): field => [prop, key]. */
    public const TRANSLATION_PATHS = [
        'cta' => ['primary.label' => ['primary', 'label'], 'secondary.label' => ['secondary', 'label']],
        // B8a.
        'before_after' => ['before.alt' => ['before', 'alt'], 'after.alt' => ['after', 'alt']],
        'flash_sale_bar' => ['button.label' => ['button', 'label']],
        'photo_grid' => ['profile.label' => ['profile', 'label']],
        // B8b.
        'form' => ['consent.text' => ['consent', 'text']],
        // P2a.
        'order_form' => ['upsell.label' => ['upsell', 'label']],
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
        return [...self::BASIC, ...array_map(fn (SectionType $t) => $t->value, SectionType::cases()), ...self::B4, ...self::B6, ...self::B8A, ...self::B8B, ...self::P2A];
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
        return in_array($type, self::BASIC, true) || in_array($type, self::B4, true) || in_array($type, self::B6, true) || in_array($type, self::B8A, true) || in_array($type, self::B8B, true)
            || in_array($type, self::P2A, true)
            ? null
            : SectionType::tryFrom($type);
    }

    /**
     * B4: whether the element has `data[id]` in a render payload (wrapped sections and DATA_TYPES).
     */
    public static function hasData(string $type): bool
    {
        return in_array($type, self::DATA_TYPES, true) || self::sectionType($type) !== null;
    }

    /**
     * B8a: whether an element with these (normalized) props gets `data[id]` from
     * BuilderElementData: the DATA_TYPES, and a chart with a store `data_source`.
     *
     * @param  array<string, mixed>  $props
     */
    public static function needsData(string $type, array $props): bool
    {
        return in_array($type, self::DATA_TYPES, true)
            || ($type === 'chart' && ($props['data_source'] ?? 'manual') !== 'manual');
    }

    /**
     * B4: the document contexts the element may be used in (contract §1: page set, header set,
     * footer set; FAQ list and contact form on CMS pages only).
     *
     * @return list<string>
     */
    public static function allowedIn(string $type): array
    {
        $contexts = match ($type) {
            'inner_row', 'heading', 'text', 'button', 'icon', 'image', 'divider', 'spacer',
            'social_icons', 'contact_block', 'custom_html', 'icon_list', 'marquee' => ['page', 'cms', 'header', 'footer', 'zone'],
            'search_box' => ['page', 'cms', 'zone', 'header'],
            'payment_icons', 'newsletter_form',
            'accordion', 'icon_box', 'logo_carousel', 'map', 'trust_badges', 'store_hours' => ['page', 'cms', 'zone', 'footer'],
            'logo', 'menu', 'language_switch' => ['header', 'footer'],
            'account_link', 'wishlist_link', 'cart_icon', 'announcement' => ['header'],
            'copyright' => ['footer'],
            'faq_list', 'contact_form' => ['cms'],
            // Wrapped sections, the other B4 page elements and (B8b) the form.
            default => ['page', 'cms', 'zone'],
        };

        // B8b: popups and bars take a fixed set of elements.
        return in_array($type, self::POPUP_ELEMENTS, true) ? [...$contexts, 'popup'] : $contexts;
    }

    public static function group(string $type): string
    {
        return match ($type) {
            'spacer', 'divider', 'inner_row' => 'layout',
            'heading', 'text', 'image', 'button', 'rich_text', 'blog_posts',
            'video', 'icon', 'cta', 'custom_html', 'faq_list', 'contact_form',
            'accordion', 'tabs', 'icon_box', 'icon_list', 'quote', 'notice', 'counter', 'steps', 'chart',
            'team', 'store_hours', 'progress_bars', 'form' => 'content',
            'gallery', 'image_carousel', 'logo_carousel', 'map', 'before_after', 'photo_grid' => 'media',
            'product_carousel', 'product_grid', 'product_tabs', 'category_strip', 'brand_strip', 'search_box', 'promo_card',
            'category_card', 'product_spotlight', 'shop_the_look', 'trust_badges', 'recently_viewed',
            'pricing_table', 'comparison_table', 'bundle', 'order_form' => 'commerce',
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
            'accordion' => 'Accordion',
            'tabs' => 'Tabs',
            'icon_box' => 'Icon box',
            'icon_list' => 'Icon list',
            'quote' => 'Quote',
            'notice' => 'Notice',
            'counter' => 'Counters',
            'steps' => 'Steps',
            'chart' => 'Chart',
            'gallery' => 'Gallery',
            'image_carousel' => 'Image carousel',
            'logo_carousel' => 'Logo carousel',
            'map' => 'Map',
            'category_card' => 'Category card',
            'product_spotlight' => 'Product spotlight',
            'shop_the_look' => 'Shop the look',
            'trust_badges' => 'Trust badges',
            'recently_viewed' => 'Recently viewed',
            'marquee' => 'Scrolling text',
            'pricing_table' => 'Pricing table',
            'before_after' => 'Before / after',
            'comparison_table' => 'Comparison table',
            'flash_sale_bar' => 'Flash sale bar',
            'bundle' => 'Bundle',
            'team' => 'Team',
            'review_wall' => 'Review wall',
            'photo_grid' => 'Photo grid',
            'store_hours' => 'Store hours',
            'progress_bars' => 'Progress bars',
            'form' => 'Form',
            'order_form' => 'Order form',
            default => SectionType::from($type)->label(),
        };
    }

    /**
     * B4: `{provider, video_id}` of a supported video URL — YouTube `youtube.com/watch?v=`,
     * `youtu.be/`, `youtube.com/shorts/` (id 6–20 of `[A-Za-z0-9_-]`) or Vimeo `vimeo.com/<digits>`
     * — or null. P1b: the rule lives in Shared (`VideoUrl`), also used by product listings.
     *
     * @return array{provider: string, video_id: string}|null
     */
    public static function parseVideoUrl(mixed $url): ?array
    {
        return VideoUrl::parse($url);
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
     * B6: the translatable fields of an element as stored — translatable() plus, for elements
     * with repeatable lists, one dot key per item and field of the (normalized) props:
     * `<list>.<item id>.<field>` (`items.i2.title`), and `<list>.<index>` for string lists
     * (`labels.0`). Field => maximum length.
     *
     * @param  array<string, mixed>  $props  normalized
     * @return array<string, int>
     */
    public static function translationFields(string $type, array $props): array
    {
        $fields = self::translatable($type);
        foreach (self::LIST_TRANSLATABLE[$type] ?? [] as $list => $itemFields) {
            foreach (is_array($props[$list] ?? null) ? $props[$list] : [] as $item) {
                if (! is_array($item) || ! is_string($item['id'] ?? null)) {
                    continue;
                }
                foreach ($itemFields as $field => $max) {
                    $fields["{$list}.{$item['id']}.{$field}"] = $max;
                }
            }
        }
        foreach (self::STRING_LIST_TRANSLATABLE[$type] ?? [] as $list => $max) {
            foreach (array_keys(is_array($props[$list] ?? null) ? $props[$list] : []) as $index) {
                $fields["{$list}.{$index}"] = $max;
            }
        }
        // B8a: nested lists and objects inside list items.
        foreach (self::nestedTargets($type, $props) as $key => ['max' => $max]) {
            $fields[$key] = $max;
        }

        return $fields;
    }

    /**
     * B8a: the stored keys of NESTED_LIST_TRANSLATABLE fields that exist in these props, with
     * where each points (`[list, index, …, field]`) and its maximum length.
     *
     * @param  array<string, mixed>  $props
     * @return array<string, array{path: list<string|int>, max: int}>
     */
    public static function nestedTargets(string $type, array $props): array
    {
        $result = [];
        foreach (self::NESTED_LIST_TRANSLATABLE[$type] ?? [] as $pattern => $max) {
            $expand = function (array $segments, mixed $value, array $key, array $path) use (&$expand, &$result, $max): void {
                if ($segments === []) {
                    return;
                }
                $segment = array_shift($segments);
                if (! is_array($value)) {
                    return;
                }
                if ($segment !== '*') {
                    if (! array_key_exists($segment, $value)) {
                        return;
                    }
                    if ($segments === []) {
                        if (is_string($value[$segment])) {
                            $result[implode('.', [...$key, $segment])] = ['path' => [...$path, $segment], 'max' => $max];
                        }

                        return;
                    }
                    $expand($segments, $value[$segment], [...$key, $segment], [...$path, $segment]);

                    return;
                }
                // A list of items with ids, or a map keyed by id (comparison cells).
                foreach ($value as $index => $item) {
                    $id = array_is_list($value) ? (is_array($item) && is_string($item['id'] ?? null) ? $item['id'] : null) : (string) $index;
                    if ($id !== null && $id !== '') {
                        $expand($segments, $item, [...$key, $id], [...$path, $index]);
                    }
                }
            };
            $expand(explode('.', $pattern), $props, [], []);
        }

        return $result;
    }

    /**
     * B6: the translatable fields of a type for the editor — translatable() plus the list
     * patterns `<list>.*.<field>` and `<list>.*`.
     *
     * @return list<string>
     */
    public static function translatablePatterns(string $type): array
    {
        $patterns = array_keys(self::translatable($type));
        foreach (self::LIST_TRANSLATABLE[$type] ?? [] as $list => $itemFields) {
            foreach (array_keys($itemFields) as $field) {
                $patterns[] = "{$list}.*.{$field}";
            }
        }
        foreach (array_keys(self::STRING_LIST_TRANSLATABLE[$type] ?? []) as $list) {
            $patterns[] = "{$list}.*";
        }
        // B8a.
        array_push($patterns, ...array_keys(self::NESTED_LIST_TRANSLATABLE[$type] ?? []));

        return $patterns;
    }

    /**
     * B6: where a translation key of an element points in its props: `[prop]`, `[prop, key]`
     * (B4 nested props), `[list, index, field]` (list items by id) or `[list, index]` (string
     * lists); null when the key names nothing in these props.
     *
     * @param  array<string, mixed>  $props
     * @return list<string|int>|null
     */
    public static function translationTarget(string $type, string $field, array $props): ?array
    {
        if (isset(self::TRANSLATION_PATHS[$type][$field])) {
            return self::TRANSLATION_PATHS[$type][$field];
        }
        $parts = explode('.', $field);
        if (count($parts) === 1) {
            return [$field];
        }
        $list = $parts[0];
        if (count($parts) === 3 && isset(self::LIST_TRANSLATABLE[$type][$list][$parts[2]]) && is_array($props[$list] ?? null)) {
            foreach ($props[$list] as $index => $item) {
                if (is_array($item) && ($item['id'] ?? null) === $parts[1]) {
                    return [$list, $index, $parts[2]];
                }
            }

            return null;
        }
        if (count($parts) === 2 && isset(self::STRING_LIST_TRANSLATABLE[$type][$list]) && ctype_digit($parts[1]) && array_key_exists((int) $parts[1], is_array($props[$list] ?? null) ? $props[$list] : [])) {
            return [$list, (int) $parts[1]];
        }
        if (isset(self::NESTED_LIST_TRANSLATABLE[$type])) {
            return self::nestedTargets($type, $props)[$field]['path'] ?? null;
        }

        return null;
    }

    /**
     * B6: media ids an element's (normalized) props use — images of image, gallery and carousel
     * elements, the category card's own image and the shop-the-look photo.
     *
     * @param  array<string, mixed>  $props
     * @return list<string>
     */
    public static function mediaIds(string $type, array $props): array
    {
        $ids = match ($type) {
            'image', 'category_card', 'shop_the_look' => [$props['media_id'] ?? null],
            'gallery', 'image_carousel' => array_column(is_array($props['images'] ?? null) ? $props['images'] : [], 'media_id'),
            'logo_carousel' => array_column(is_array($props['logos'] ?? null) ? $props['logos'] : [], 'media_id'),
            // B8a: before / after photos, team portraits and the photo grid.
            'before_after' => [$props['before']['media_id'] ?? null, $props['after']['media_id'] ?? null],
            'team' => array_column(is_array($props['members'] ?? null) ? $props['members'] : [], 'media_id'),
            'photo_grid' => array_column(is_array($props['images'] ?? null) ? $props['images'] : [], 'media_id'),
            default => [],
        };

        return array_values(array_unique(array_filter($ids, 'is_string')));
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
            // B6. Chart, gallery, carousels, map, category card, product spotlight and shop the
            // look need content before they are valid (the editor's setup dialog).
            'accordion' => [
                'items' => [
                    ['id' => 'i1', 'title' => 'How long does delivery take?', 'html' => '<p>Most orders arrive within 2 to 3 days.</p>'],
                    ['id' => 'i2', 'title' => 'Can I return an item?', 'html' => '<p>Yes, within 7 days of delivery.</p>'],
                ],
                'open_first' => true,
                'allow_multiple' => false,
                'style' => 'boxed',
            ],
            'tabs' => [
                'items' => [
                    ['id' => 'i1', 'title' => 'Details', 'html' => '<p>Tell your customers what makes it special.</p>'],
                    ['id' => 'i2', 'title' => 'Delivery', 'html' => '<p>Explain how and when orders arrive.</p>'],
                ],
                'layout' => 'horizontal',
            ],
            'icon_box' => ['icon' => 'star', 'title' => 'Why customers love us', 'text' => '', 'link' => null, 'layout' => 'top', 'icon_style' => 'circle'],
            'icon_list' => [
                'items' => [
                    ['id' => 'i1', 'icon' => 'check', 'text' => 'Free delivery on larger orders', 'link' => null],
                    ['id' => 'i2', 'icon' => 'check', 'text' => 'Easy returns', 'link' => null],
                    ['id' => 'i3', 'icon' => 'check', 'text' => 'Secure payment', 'link' => null],
                ],
                'layout' => 'vertical',
            ],
            'quote' => ['text' => 'Great products and fast delivery.', 'author' => 'A happy customer', 'role' => '', 'style' => 'card'],
            'notice' => ['tone' => 'info', 'title' => 'Good to know', 'text' => '', 'show_icon' => true],
            'counter' => [
                'items' => [
                    ['id' => 'i1', 'value' => 1200, 'prefix' => '', 'suffix' => '+', 'label' => 'Happy customers'],
                    ['id' => 'i2', 'value' => 350, 'prefix' => '', 'suffix' => '+', 'label' => 'Products'],
                    ['id' => 'i3', 'value' => 4.9, 'prefix' => '', 'suffix' => '/5', 'label' => 'Average rating'],
                ],
                'animate' => true,
            ],
            'steps' => [
                'items' => [
                    ['id' => 'i1', 'title' => 'Choose', 'text' => 'Pick what you like from the shop.', 'icon' => null],
                    ['id' => 'i2', 'title' => 'Order', 'text' => 'Pay online or on delivery.', 'icon' => null],
                    ['id' => 'i3', 'title' => 'Enjoy', 'text' => 'We bring it to your door.', 'icon' => null],
                ],
                'layout' => 'horizontal',
                'numbered' => true,
            ],
            'chart' => [
                'kind' => 'column',
                'title' => 'Our growth',
                'description' => '',
                'labels' => ['2023', '2024', '2025'],
                'series' => [['id' => 's1', 'name' => 'Orders', 'values' => [120, 340, 560]]],
                'unit' => '',
                'unit_position' => 'after',
                'y_starts_at_zero' => true,
                'show_values' => 'none',
                'show_legend' => true,
                'show_table' => false,
                'height' => 320,
                // B8a.
                'data_source' => 'manual',
                'source_product_id' => null,
            ],
            'gallery' => ['images' => [], 'columns' => ['base' => 3, 'tablet' => 3, 'mobile' => 2], 'aspect' => 'square', 'lightbox' => true, 'gap' => 'md'],
            'image_carousel' => ['images' => [], 'autoplay' => 0, 'show_dots' => true, 'show_arrows' => true, 'aspect' => '16:9'],
            'logo_carousel' => ['logos' => [], 'grayscale' => true, 'speed' => 'normal'],
            'map' => ['query' => '', 'title' => 'Find our store', 'height' => 360, 'zoom' => 15],
            'category_card' => ['category_id' => null, 'media_id' => null, 'title' => null, 'button_label' => 'Shop now', 'layout' => 'overlay'],
            'product_spotlight' => ['product_id' => null, 'layout' => 'image-left', 'show_description' => true, 'badge' => ''],
            'shop_the_look' => ['media_id' => null, 'alt' => '', 'title' => '', 'hotspots' => []],
            'trust_badges' => [
                'items' => [
                    ['id' => 'i1', 'icon' => 'truck', 'title' => 'Fast delivery', 'text' => ''],
                    ['id' => 'i2', 'icon' => 'shield-check', 'title' => 'Secure payment', 'text' => ''],
                    ['id' => 'i3', 'icon' => 'rotate-ccw', 'title' => 'Easy returns', 'text' => ''],
                ],
                'style' => 'row',
            ],
            'recently_viewed' => ['title' => 'Recently viewed', 'limit' => 6],
            'marquee' => [
                'items' => [
                    ['id' => 'i1', 'text' => 'Free delivery on larger orders'],
                    ['id' => 'i2', 'text' => 'New arrivals every week'],
                ],
                'speed' => 'normal',
                'direction' => 'left',
                'separator' => 'dot',
            ],
            // B8a. Before / after, comparison products (optional), bundle, review wall from a
            // product and the photo grid need content before they are valid (setup dialogs).
            'pricing_table' => [
                'plans' => [
                    [
                        'id' => 'p1', 'name' => 'Basic', 'price' => null, 'price_text' => 'Free', 'period' => '',
                        'description' => 'Everything you need to start.',
                        'features' => [
                            ['id' => 'f1', 'text' => 'Delivery inside Dhaka', 'included' => true],
                            ['id' => 'f2', 'text' => 'Gift wrapping', 'included' => false],
                        ],
                        'button' => ['label' => 'Get started', 'url' => '/shop'],
                        'highlighted' => false,
                        'badge' => '',
                    ],
                    [
                        'id' => 'p2', 'name' => 'Plus', 'price' => '499.00', 'price_text' => '', 'period' => '/month',
                        'description' => 'For regular shoppers.',
                        'features' => [
                            ['id' => 'f1', 'text' => 'Free delivery everywhere', 'included' => true],
                            ['id' => 'f2', 'text' => 'Gift wrapping', 'included' => true],
                        ],
                        'button' => ['label' => 'Choose Plus', 'url' => '/shop'],
                        'highlighted' => true,
                        'badge' => 'Popular',
                    ],
                ],
            ],
            'before_after' => [
                'before' => ['media_id' => null, 'alt' => ''],
                'after' => ['media_id' => null, 'alt' => ''],
                'before_label' => 'Before',
                'after_label' => 'After',
                'start' => 50,
                'orientation' => 'horizontal',
                'aspect' => '4:3',
            ],
            'comparison_table' => [
                'columns' => [
                    ['id' => 'c1', 'title' => 'Standard', 'product_id' => null, 'highlighted' => false],
                    ['id' => 'c2', 'title' => 'Premium', 'product_id' => null, 'highlighted' => true],
                ],
                'rows' => [
                    ['id' => 'r1', 'label' => 'Free delivery', 'cells' => ['c1' => ['kind' => 'no', 'text' => ''], 'c2' => ['kind' => 'yes', 'text' => '']]],
                    ['id' => 'r2', 'label' => 'Warranty', 'cells' => ['c1' => ['kind' => 'text', 'text' => '6 months'], 'c2' => ['kind' => 'text', 'text' => '1 year']]],
                ],
                'show_prices' => true,
                'show_buttons' => true,
            ],
            'flash_sale_bar' => [
                'promotion_id' => null,
                'title' => 'Flash sale',
                'text' => '',
                'show_products' => true,
                'product_limit' => 4,
                'style' => 'bar',
                'button' => ['label' => 'Shop the sale', 'url' => '/shop'],
            ],
            'bundle' => ['items' => [], 'title' => 'Frequently bought together', 'text' => '', 'button_label' => 'Add all to cart'],
            'team' => [
                'members' => [
                    ['id' => 'm1', 'media_id' => null, 'name' => 'Your name', 'role' => 'Founder', 'bio' => '', 'links' => []],
                    ['id' => 'm2', 'media_id' => null, 'name' => 'A team member', 'role' => 'Customer care', 'bio' => '', 'links' => []],
                ],
                'columns' => ['base' => 3, 'tablet' => 2, 'mobile' => 1],
                'style' => 'card',
            ],
            'review_wall' => [
                'source' => 'latest',
                'product_id' => null,
                'min_rating' => 4,
                'limit' => 6,
                'layout' => 'grid',
                'show_product' => true,
                'show_summary' => true,
                'title' => 'What our customers say',
            ],
            'photo_grid' => [
                'images' => [],
                'columns' => ['base' => 6, 'tablet' => 3, 'mobile' => 3],
                'gap' => 'sm',
                'profile' => null,
                'hover' => 'zoom',
            ],
            'store_hours' => [
                'days' => array_map(fn (string $day) => ['day' => $day, 'closed' => false, 'open' => $day === 'fri' ? '15:00' : '10:00', 'close' => '21:00'], self::WEEKDAYS),
                'title' => 'Opening hours',
                'note' => '',
                'show_open_now' => true,
                'highlight_today' => true,
                'week_starts' => 'sat',
            ],
            'progress_bars' => [
                'items' => [
                    ['id' => 'i1', 'label' => 'Happy customers', 'value' => 98],
                    ['id' => 'i2', 'label' => 'Orders delivered on time', 'value' => 95],
                    ['id' => 'i3', 'label' => 'Products made locally', 'value' => 80],
                ],
                'style' => 'bar',
                'show_value' => true,
                'animate' => true,
            ],
            // B8b: a contact form (name, e-mail for replies, message).
            'form' => [
                'title' => 'Get in touch',
                'text' => '',
                'fields' => [
                    ['id' => 'f_name', 'kind' => 'text', 'label' => 'Your name', 'placeholder' => '', 'help' => '', 'required' => true, 'options' => [], 'min' => null, 'max' => null, 'max_length' => null, 'reply_to' => false],
                    ['id' => 'f_email', 'kind' => 'email', 'label' => 'E-mail', 'placeholder' => '', 'help' => '', 'required' => true, 'options' => [], 'min' => null, 'max' => null, 'max_length' => null, 'reply_to' => true],
                    ['id' => 'f_message', 'kind' => 'textarea', 'label' => 'Message', 'placeholder' => '', 'help' => '', 'required' => true, 'options' => [], 'min' => null, 'max' => null, 'max_length' => null, 'reply_to' => false],
                ],
                'submit_label' => 'Send',
                'success_message' => 'Thank you! We will get back to you soon.',
                'consent' => null,
                'notify_email' => null,
                'layout' => 'stacked',
            ],
            // P2a: a one-product order form; the product is chosen in the editor's setup dialog.
            'order_form' => [
                'product_id' => null,
                'title' => 'Order now',
                'text' => '',
                'show_variants' => true,
                'quantity' => ['default' => 1, 'max' => 10],
                'fields' => ['email' => 'optional', 'note' => 'optional'],
                'payment' => 'cod_only',
                'button_label' => 'Confirm order',
                'success_message' => 'Thank you! Your order has been placed. We will call you soon to confirm it.',
                'upsell' => null,
                'layout' => 'stacked',
            ],
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
                // B6: list item fields as patterns (`items.*.title`; stored as `items.<item id>.title`).
                'translatable' => self::translatablePatterns($type),
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
                // B6.
                'lists' => array_map(fn (array $r) => ['min' => $r[0], 'max' => $r[1]], self::LIST_LIMITS),
                'b6_text' => self::B6_TEXT_LIMITS,
                'list_translatable' => self::LIST_TRANSLATABLE,
                'string_list_translatable' => self::STRING_LIST_TRANSLATABLE,
                'item_id_pattern' => BuilderDocumentSchema::ID_PATTERN,
                'counter_value' => ['min' => self::COUNTER_VALUE[0], 'max' => self::COUNTER_VALUE[1], 'decimals' => 2],
                'chart_value' => ['max_abs' => self::CHART_VALUE_MAX],
                'chart_pie_labels' => self::CHART_PIE_LABELS,
                'chart_height' => ['min' => self::CHART_HEIGHT[0], 'max' => self::CHART_HEIGHT[1]],
                'gallery_columns' => array_map(fn (array $r) => ['min' => $r[0], 'max' => $r[1]], self::GALLERY_COLUMNS),
                'carousel_autoplay' => ['min' => self::CAROUSEL_AUTOPLAY[0], 'max' => self::CAROUSEL_AUTOPLAY[1]],
                'map_height' => ['min' => self::MAP_HEIGHT[0], 'max' => self::MAP_HEIGHT[1]],
                'map_zoom' => ['min' => self::MAP_ZOOM[0], 'max' => self::MAP_ZOOM[1]],
                'hotspot_position' => ['min' => 0, 'max' => 100, 'decimals' => 2],
                'recently_viewed_limit' => ['min' => self::RECENTLY_VIEWED_LIMIT[0], 'max' => self::RECENTLY_VIEWED_LIMIT[1]],
                'motion_duration' => ['min' => StyleSchema::MOTION_DURATION[0], 'max' => StyleSchema::MOTION_DURATION[1]],
                'motion_delay' => ['min' => StyleSchema::MOTION_DELAY[0], 'max' => StyleSchema::MOTION_DELAY[1]],
                'shape_height' => ['min' => BuilderDocumentSchema::SHAPE_HEIGHT[0], 'max' => BuilderDocumentSchema::SHAPE_HEIGHT[1]],
                'sticky_sections' => 1,
                // B8a.
                'b8a_text' => self::B8A_TEXT_LIMITS,
                'nested_list_translatable' => self::NESTED_LIST_TRANSLATABLE,
                'money_pattern' => self::MONEY_PATTERN,
                'time_pattern' => self::TIME_PATTERN,
                'before_after_start' => ['min' => self::BEFORE_AFTER_START[0], 'max' => self::BEFORE_AFTER_START[1]],
                'flash_sale_product_limit' => ['min' => self::FLASH_SALE_PRODUCT_LIMIT[0], 'max' => self::FLASH_SALE_PRODUCT_LIMIT[1]],
                'team_columns' => array_map(fn (array $r) => ['min' => $r[0], 'max' => $r[1]], self::TEAM_COLUMNS),
                'review_min_rating' => ['min' => self::REVIEW_MIN_RATING[0], 'max' => self::REVIEW_MIN_RATING[1]],
                'review_limit' => ['min' => self::REVIEW_LIMIT[0], 'max' => self::REVIEW_LIMIT[1]],
                'review_body' => self::REVIEW_BODY_MAX,
                'photo_grid_columns' => array_map(fn (array $r) => ['min' => $r[0], 'max' => $r[1]], self::PHOTO_GRID_COLUMNS),
                'progress_value' => ['min' => 0, 'max' => 100, 'decimals' => 1],
                'chart_stacked_series' => ['min' => self::CHART_STACKED_SERIES[0], 'max' => self::CHART_STACKED_SERIES[1]],
                'chart_store_categories' => self::CHART_STORE_CATEGORIES,
                // B8b.
                'b8b_text' => self::B8B_TEXT_LIMITS,
                'form_max_length' => ['min' => self::FORM_MAX_LENGTH[0], 'max' => self::FORM_MAX_LENGTH[1], 'defaults' => self::FORM_DEFAULT_MAX_LENGTH],
                'form_number' => ['max_abs' => self::FORM_NUMBER_BOUND, 'decimals' => 2],
                'popup' => PopupSettings::limits(),
                // P2a.
                'order_form_quantity' => [
                    'default' => ['min' => self::ORDER_FORM_QUANTITY_DEFAULT[0], 'max' => self::ORDER_FORM_QUANTITY_DEFAULT[1]],
                    'max' => ['min' => self::ORDER_FORM_QUANTITY_MAX[0], 'max' => self::ORDER_FORM_QUANTITY_MAX[1]],
                ],
            ],
            // B8a: elements whose data depends on their props (a chart has data only with a store source).
            'data_when' => ['chart' => 'data_source!=manual'],
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
                // B6.
                'accordion_styles' => self::ACCORDION_STYLES,
                'tabs_layouts' => self::TABS_LAYOUTS,
                'icon_box_layouts' => self::ICON_BOX_LAYOUTS,
                'icon_styles' => self::ICON_STYLES,
                'icon_list_layouts' => self::ICON_LIST_LAYOUTS,
                'quote_styles' => self::QUOTE_STYLES,
                'notice_tones' => self::NOTICE_TONES,
                'steps_layouts' => self::STEPS_LAYOUTS,
                'chart_kinds' => self::CHART_KINDS,
                'chart_unit_positions' => self::CHART_UNIT_POSITIONS,
                'chart_show_values' => self::CHART_SHOW_VALUES,
                'gallery_aspects' => self::GALLERY_ASPECTS,
                'gallery_gaps' => self::GALLERY_GAPS,
                'speeds' => self::SPEEDS,
                'category_card_layouts' => self::CATEGORY_CARD_LAYOUTS,
                'spotlight_layouts' => self::SPOTLIGHT_LAYOUTS,
                'trust_badge_styles' => self::TRUST_BADGE_STYLES,
                'marquee_directions' => self::MARQUEE_DIRECTIONS,
                'marquee_separators' => self::MARQUEE_SEPARATORS,
                'motion_entrances' => StyleSchema::MOTION_ENTRANCES,
                'section_shapes' => BuilderDocumentSchema::SHAPES,
                // B8a.
                'chart_stacked_kinds' => self::CHART_STACKED_KINDS,
                'chart_data_sources' => self::CHART_DATA_SOURCES,
                'before_after_orientations' => self::BEFORE_AFTER_ORIENTATIONS,
                'before_after_aspects' => self::BEFORE_AFTER_ASPECTS,
                'comparison_cell_kinds' => self::COMPARISON_CELL_KINDS,
                'flash_sale_styles' => self::FLASH_SALE_STYLES,
                'team_styles' => self::TEAM_STYLES,
                'team_link_kinds' => self::TEAM_LINK_KINDS,
                'review_sources' => self::REVIEW_SOURCES,
                'review_layouts' => self::REVIEW_LAYOUTS,
                'photo_grid_gaps' => self::PHOTO_GRID_GAPS,
                'photo_grid_hovers' => self::PHOTO_GRID_HOVERS,
                'weekdays' => self::WEEKDAYS,
                'week_starts' => self::WEEK_STARTS,
                'progress_styles' => self::PROGRESS_STYLES,
                // B8b.
                'button_actions' => self::BUTTON_ACTIONS,
                'form_field_kinds' => self::FORM_FIELD_KINDS,
                'form_choice_kinds' => self::FORM_CHOICE_KINDS,
                'form_layouts' => self::FORM_LAYOUTS,
                'popup_layouts' => PopupSettings::LAYOUTS,
                'popup_positions' => PopupSettings::POSITIONS,
                'popup_widths' => PopupSettings::WIDTHS,
                'popup_triggers' => PopupSettings::TRIGGERS,
                'popup_frequencies' => PopupSettings::FREQUENCIES,
                'popup_pages' => PopupSettings::PAGES,
                'popup_devices' => PopupSettings::DEVICES,
                'popup_audiences' => PopupSettings::AUDIENCES,
                'popup_never_on' => PopupSettings::NEVER_ON,
                // P2a.
                'order_form_email' => self::ORDER_FORM_EMAIL,
                'order_form_note' => self::ORDER_FORM_NOTE,
                'order_form_payment' => self::ORDER_FORM_PAYMENT,
            ],
            // B8b: the settings a new popup starts with.
            'popup_defaults' => PopupSettings::present(PopupSettings::defaults()),
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
