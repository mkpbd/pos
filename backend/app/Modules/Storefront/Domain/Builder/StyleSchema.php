<?php

namespace App\Modules\Storefront\Domain\Builder;

use App\Modules\Storefront\Domain\ThemeSchema;

/**
 * Structured style values of builder nodes (B1, plan §4): `style = {base?, tablet?, mobile?}`,
 * each a sparse set of groups (background, color, typography, spacing, size, layout, border,
 * effects). Normalizing keeps only known keys with valid, bounded values and never fills
 * defaults: anything unknown or invalid is dropped silently, as are groups and breakpoints
 * left empty. The storefront compiles the result to CSS (and validates it again).
 */
final class StyleSchema
{
    public const BREAKPOINTS = ['base', 'tablet', 'mobile'];

    public const UNITS = ['px', 'rem', 'em', '%', 'vh', 'vw'];

    /** Largest absolute value per unit. */
    public const UNIT_BOUNDS = ['px' => 2000, 'rem' => 100, 'em' => 100, '%' => 100, 'vh' => 100, 'vw' => 100];

    public const FONTS = ['theme:heading', 'theme:body'];

    public const TEXT_ALIGNS = ['left', 'center', 'right', 'justify'];

    public const TEXT_TRANSFORMS = ['none', 'uppercase', 'lowercase', 'capitalize'];

    public const BACKGROUND_TYPES = ['none', 'color', 'gradient', 'image'];

    public const BACKGROUND_POSITIONS = ['center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];

    public const BACKGROUND_SIZES = ['cover', 'contain', 'auto'];

    public const GRADIENT_TYPES = ['linear', 'radial'];

    public const GRADIENT_SHAPES = ['circle', 'ellipse'];

    public const GRADIENT_STOPS = ['min' => 2, 'max' => 5];

    public const LAYOUT_ALIGNS = ['start', 'center', 'end', 'stretch'];

    public const LAYOUT_JUSTIFY = ['start', 'center', 'end', 'between', 'around'];

    public const BORDER_STYLES = ['none', 'solid', 'dashed', 'dotted'];

    public const HOVER_TRANSFORMS = ['none', 'lift', 'grow'];

    public const MAX_SHADOWS = 3;

    public const MAX_TEXT_SHADOWS = 2;

    public const SIDES = ['top', 'right', 'bottom', 'left'];

    public const CORNERS = ['tl', 'tr', 'br', 'bl'];

    private const LENGTH = '/^(-?)(\d{1,4}(?:\.\d{1,2})?)(px|rem|em|%|vh|vw)$/';

    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';

    /**
     * @return array<string, array<string, mixed>>
     */
    public static function normalize(mixed $style): array
    {
        if (! is_array($style)) {
            return [];
        }

        $result = [];
        foreach (self::BREAKPOINTS as $breakpoint) {
            $groups = self::groups($style[$breakpoint] ?? null);
            if ($groups !== []) {
                $result[$breakpoint] = $groups;
            }
        }

        return $result;
    }

    /**
     * Media ids a (normalized) style uses: background images at every breakpoint.
     *
     * @param  array<string, mixed>  $style
     * @return list<string>
     */
    public static function mediaIds(array $style): array
    {
        $ids = [];
        foreach ($style as $groups) {
            $id = $groups['background']['image']['media_id'] ?? null;
            if (is_string($id)) {
                $ids[] = $id;
            }
        }

        return $ids;
    }

    /**
     * @return array<string, mixed>
     */
    private static function groups(mixed $groups): array
    {
        if (! is_array($groups)) {
            return [];
        }

        return self::compact([
            'background' => self::background($groups['background'] ?? null),
            'color' => self::color($groups['color'] ?? null),
            'typography' => self::typography($groups['typography'] ?? null),
            'spacing' => self::spacing($groups['spacing'] ?? null),
            'size' => self::size($groups['size'] ?? null),
            'layout' => self::layout($groups['layout'] ?? null),
            'border' => self::border($groups['border'] ?? null),
            'effects' => self::effects($groups['effects'] ?? null),
        ]) ?? [];
    }

    /**
     * `#rrggbb` / `#rrggbbaa` (lower-cased) or `theme:<colour role>`.
     */
    public static function color(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }
        if (preg_match('/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/', $value) === 1) {
            return strtolower($value);
        }
        if (str_starts_with($value, 'theme:') && in_array(substr($value, 6), ThemeSchema::COLORS, true)) {
            return $value;
        }

        return null;
    }

    /**
     * A length string within its unit's bounds, or null.
     *
     * @param  list<string>  $units
     */
    public static function length(mixed $value, bool $negative = false, bool $auto = false, array $units = self::UNITS, ?float $maxPx = null): ?string
    {
        if (! is_string($value)) {
            return null;
        }
        if ($value === 'auto') {
            return $auto ? $value : null;
        }
        if (preg_match(self::LENGTH, $value, $m) !== 1 || ! in_array($m[3], $units, true)) {
            return null;
        }
        if ($m[1] === '-' && ! $negative) {
            return null;
        }
        $bound = $m[3] === 'px' && $maxPx !== null ? $maxPx : self::UNIT_BOUNDS[$m[3]];

        return (float) $m[2] <= $bound ? $value : null;
    }

    private static function number(mixed $value, float $min, float $max): int|float|null
    {
        if (! is_int($value) && ! is_float($value)) {
            return null;
        }

        return $value >= $min && $value <= $max ? $value : null;
    }

    private static function enum(mixed $value, array $allowed): ?string
    {
        return is_string($value) && in_array($value, $allowed, true) ? $value : null;
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function background(mixed $value): ?array
    {
        if (! is_array($value) || ($type = self::enum($value['type'] ?? null, self::BACKGROUND_TYPES)) === null) {
            return null;
        }

        $image = null;
        if (is_array($value['image'] ?? null) && is_string($id = $value['image']['media_id'] ?? null) && preg_match(self::UUID, strtolower($id)) === 1) {
            $image = self::compact([
                'media_id' => strtolower($id),
                'position' => self::enum($value['image']['position'] ?? null, self::BACKGROUND_POSITIONS),
                'size' => self::enum($value['image']['size'] ?? null, self::BACKGROUND_SIZES),
                'repeat' => is_bool($value['image']['repeat'] ?? null) ? $value['image']['repeat'] : null,
            ]);
        }

        return self::compact([
            'type' => $type,
            'color' => self::color($value['color'] ?? null),
            'gradient' => self::gradient($value['gradient'] ?? null),
            'image' => $image,
            'overlay' => self::color($value['overlay'] ?? null) ?? self::gradient($value['overlay'] ?? null),
        ]);
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function gradient(mixed $value): ?array
    {
        if (! is_array($value) || ($type = self::enum($value['type'] ?? null, self::GRADIENT_TYPES)) === null || ! is_array($value['stops'] ?? null) || ! array_is_list($value['stops'])) {
            return null;
        }

        $stops = [];
        foreach ($value['stops'] as $stop) {
            $color = is_array($stop) ? self::color($stop['color'] ?? null) : null;
            $position = is_array($stop) ? self::number($stop['position'] ?? null, 0, 100) : null;
            if ($color === null || $position === null) {
                return null;
            }
            $stops[] = ['color' => $color, 'position' => $position];
        }
        if (count($stops) < self::GRADIENT_STOPS['min'] || count($stops) > self::GRADIENT_STOPS['max']) {
            return null;
        }

        return self::compact([
            'type' => $type,
            'angle' => $type === 'linear' ? self::number($value['angle'] ?? null, 0, 360) : null,
            'shape' => $type === 'radial' ? self::enum($value['shape'] ?? null, self::GRADIENT_SHAPES) : null,
            'stops' => $stops,
        ]);
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function typography(mixed $value): ?array
    {
        if (! is_array($value)) {
            return null;
        }
        $weight = $value['weight'] ?? null;

        return self::compact([
            'font' => self::enum($value['font'] ?? null, self::FONTS),
            'size' => self::length($value['size'] ?? null),
            'weight' => is_int($weight) && $weight >= 100 && $weight <= 900 && $weight % 100 === 0 ? $weight : null,
            'line_height' => self::number($value['line_height'] ?? null, 0.8, 3),
            'letter_spacing' => self::length($value['letter_spacing'] ?? null, negative: true, units: ['em', 'px']),
            'align' => self::enum($value['align'] ?? null, self::TEXT_ALIGNS),
            'transform' => self::enum($value['transform'] ?? null, self::TEXT_TRANSFORMS),
        ]);
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function spacing(mixed $value): ?array
    {
        if (! is_array($value)) {
            return null;
        }

        return self::compact([
            'margin' => self::sides($value['margin'] ?? null, true),
            'padding' => self::sides($value['padding'] ?? null, false),
        ]);
    }

    /**
     * @return array<string, string>|null
     */
    private static function sides(mixed $value, bool $margin): ?array
    {
        if (! is_array($value)) {
            return null;
        }
        $result = [];
        foreach (self::SIDES as $side) {
            $result[$side] = self::length($value[$side] ?? null, negative: $margin, auto: $margin);
        }

        return self::compact($result);
    }

    /**
     * @return array<string, string>|null
     */
    private static function size(mixed $value): ?array
    {
        if (! is_array($value)) {
            return null;
        }

        return self::compact([
            'width' => self::length($value['width'] ?? null),
            'height' => self::length($value['height'] ?? null),
            'min_height' => self::length($value['min_height'] ?? null),
            'max_width' => self::length($value['max_width'] ?? null),
        ]);
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function layout(mixed $value): ?array
    {
        if (! is_array($value)) {
            return null;
        }

        return self::compact([
            'gap' => self::length($value['gap'] ?? null),
            'row_gap' => self::length($value['row_gap'] ?? null),
            'align' => self::enum($value['align'] ?? null, self::LAYOUT_ALIGNS),
            'justify' => self::enum($value['justify'] ?? null, self::LAYOUT_JUSTIFY),
            'wrap' => is_bool($value['wrap'] ?? null) ? $value['wrap'] : null,
        ]);
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function border(mixed $value): ?array
    {
        if (! is_array($value)) {
            return null;
        }
        $radius = null;
        if (is_array($value['radius'] ?? null)) {
            $radius = [];
            foreach (self::CORNERS as $corner) {
                $radius[$corner] = self::length($value['radius'][$corner] ?? null);
            }
            $radius = self::compact($radius);
        }

        return self::compact([
            'width' => self::length($value['width'] ?? null, units: ['px'], maxPx: 20),
            'style' => self::enum($value['style'] ?? null, self::BORDER_STYLES),
            'color' => self::color($value['color'] ?? null),
            'radius' => $radius,
        ]);
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function effects(mixed $value): ?array
    {
        if (! is_array($value)) {
            return null;
        }
        $hover = null;
        if (is_array($value['hover'] ?? null)) {
            $hover = self::compact([
                'color' => self::color($value['hover']['color'] ?? null),
                'background_color' => self::color($value['hover']['background_color'] ?? null),
                'shadow' => self::shadows($value['hover']['shadow'] ?? null, self::MAX_SHADOWS),
                'transform' => self::enum($value['hover']['transform'] ?? null, self::HOVER_TRANSFORMS),
            ]);
        }

        return self::compact([
            'shadow' => self::shadows($value['shadow'] ?? null, self::MAX_SHADOWS),
            'text_shadow' => self::shadows($value['text_shadow'] ?? null, self::MAX_TEXT_SHADOWS),
            'opacity' => self::number($value['opacity'] ?? null, 0, 1),
            'hover' => $hover,
        ]);
    }

    /**
     * Valid shadow layers (at most `$max`; invalid layers dropped); null when every layer was
     * invalid, [] for an explicit empty list.
     *
     * @return list<array<string, mixed>>|null
     */
    private static function shadows(mixed $value, int $max): ?array
    {
        if (! is_array($value) || ! array_is_list($value)) {
            return null;
        }
        // An explicit empty list is kept ("no shadow", e.g. overriding a desktop shadow on mobile).
        if ($value === []) {
            return [];
        }
        $result = [];
        foreach ($value as $shadow) {
            if (! is_array($shadow)) {
                continue;
            }
            // x, y, blur and colour are required; spread and inset optional.
            $layer = [
                'x' => self::number($shadow['x'] ?? null, -100, 100),
                'y' => self::number($shadow['y'] ?? null, -100, 100),
                'blur' => self::number($shadow['blur'] ?? null, 0, 200),
                'spread' => self::number($shadow['spread'] ?? null, -100, 100),
                'color' => self::color($shadow['color'] ?? null),
                'inset' => is_bool($shadow['inset'] ?? null) ? $shadow['inset'] : null,
            ];
            if ($layer['x'] === null || $layer['y'] === null || $layer['blur'] === null || $layer['color'] === null) {
                continue;
            }
            $result[] = array_filter($layer, fn ($v) => $v !== null);
        }

        return $result === [] ? null : array_slice($result, 0, $max);
    }

    /**
     * Drops null values (invalid or empty groups come back as null); null when nothing is left.
     *
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>|null
     */
    private static function compact(array $values): ?array
    {
        $values = array_filter($values, fn ($v) => $v !== null);

        return $values === [] ? null : $values;
    }
}
