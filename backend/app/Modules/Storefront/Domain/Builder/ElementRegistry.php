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
    public const GROUPS = ['layout', 'content', 'commerce', 'marketing'];

    /** Elements defined by the builder itself (not homepage section types). */
    public const BASIC = ['heading', 'text', 'image', 'button', 'spacer', 'divider', 'inner_row'];

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

    /** Props holding rich text (sanitized with the HtmlSanitizer on save). */
    public const HTML_PROPS = ['text' => ['html'], 'rich_text' => ['body_html']];

    /**
     * @return list<string>
     */
    public static function types(): array
    {
        return [...self::BASIC, ...array_map(fn (SectionType $t) => $t->value, SectionType::cases())];
    }

    public static function exists(mixed $type): bool
    {
        return is_string($type) && in_array($type, self::types(), true);
    }

    /**
     * The homepage section type an element wraps, or null for basic elements.
     */
    public static function sectionType(string $type): ?SectionType
    {
        return in_array($type, self::BASIC, true) ? null : SectionType::tryFrom($type);
    }

    public static function group(string $type): string
    {
        return match ($type) {
            'spacer', 'divider', 'inner_row' => 'layout',
            'heading', 'text', 'image', 'button', 'rich_text', 'blog_posts' => 'content',
            'product_carousel', 'product_grid', 'product_tabs', 'category_strip', 'brand_strip' => 'commerce',
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
            default => SectionType::from($type)->label(),
        };
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
