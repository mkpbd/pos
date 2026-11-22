<?php

namespace App\Modules\Storefront\Domain\Builder\Wizard;

/**
 * B21: the wizard's "look" — the B18 motion themes Calm, Lively and Festive applied to a new
 * page, server-side, the way the editor applies them (frontend `motion-themes.ts`, THEME_SPECS):
 * sections fade or rise, headings / texts / pictures enter, buttons react to the pointer,
 * product listings get a card hover, section dividers flow; the page's hero heading gets the
 * word-by-word effect (Lively, Festive); Festive buttons shine (3 times, never forever) within
 * the page check's loop limit. The first section and its pictures and headings never get an
 * entrance (the top of the page paints at once), and it gets no scroll effect. Nodes that
 * already move (a template's own motion) are left as they are. Sets `motion_theme`.
 */
final class WizardMotion
{
    /** At most this many looping nodes in one section (page check MOTION_TOO_MUCH). */
    private const MAX_LOOPS_PER_SECTION = 6;

    private const PICTURE_TYPES = ['image', 'hero_slider', 'image_carousel', 'gallery', 'video', 'before_after', 'shop_the_look', 'category_card'];

    private const HEADING_TYPES = ['heading', 'cta'];

    private const CARD_HOVER_TYPES = ['product_grid', 'product_carousel', 'product_tabs', 'product_listing', 'category_card', 'product_spotlight', 'shop_the_look'];

    private const ROLES = [
        'heading' => 'heading', 'cta' => 'heading',
        'text' => 'text', 'rich_text' => 'text',
        'image' => 'image', 'image_carousel' => 'image', 'gallery' => 'image', 'video' => 'image', 'before_after' => 'image',
        'button' => 'button',
    ];

    /**
     * @var array<string, array<string, mixed>>
     */
    private const SPECS = [
        'calm' => [
            'section' => ['entrance' => ['entrance' => 'fade', 'duration' => 800, 'easing' => 'gentle'], 'stagger' => 80, 'easing' => 'gentle', 'scroll' => null],
            'heading' => ['entrance' => 'fade', 'duration' => 800, 'easing' => 'gentle'],
            'text' => ['entrance' => 'fade', 'duration' => 800, 'easing' => 'gentle'],
            'image' => ['entrance' => 'fade', 'duration' => 900, 'easing' => 'gentle'],
            'button' => ['hover' => 'lift-shadow', 'loop' => null],
            'card_hover' => 'lift',
            'divider' => null,
            'hero_text' => null,
        ],
        'lively' => [
            'section' => ['entrance' => null, 'stagger' => 100, 'easing' => 'spring', 'scroll' => ['effect' => 'rise', 'intensity' => 'subtle']],
            'heading' => ['entrance' => 'slide-up', 'duration' => 600, 'easing' => 'spring'],
            'text' => ['entrance' => 'slide-up', 'duration' => 600, 'easing' => 'spring'],
            'image' => ['entrance' => 'zoom', 'duration' => 700, 'easing' => 'spring'],
            'button' => ['hover' => 'pop', 'loop' => null],
            'card_hover' => 'tilt_3d',
            'divider' => 'flow',
            'hero_text' => 'reveal_words',
        ],
        'festive' => [
            'section' => ['entrance' => null, 'stagger' => 120, 'easing' => 'bounce', 'scroll' => ['effect' => 'rise', 'intensity' => 'subtle']],
            'heading' => ['entrance' => 'bounce-in', 'duration' => 800, 'easing' => 'bounce'],
            'text' => ['entrance' => 'slide-up', 'duration' => 600, 'easing' => 'spring'],
            'image' => ['entrance' => 'zoom', 'duration' => 700, 'easing' => 'spring'],
            'button' => ['hover' => 'pop', 'loop' => 'shine'],
            'card_hover' => 'glare',
            'divider' => 'flow',
            'hero_text' => 'reveal_words',
        ],
    ];

    /**
     * The content with the look applied (`current`: unchanged).
     *
     * @param  array<string, mixed>  $content  `{sections, ...}` (concrete, not yet normalized)
     * @return array<string, mixed>
     */
    public static function apply(array $content, string $look): array
    {
        $spec = self::SPECS[$look] ?? null;
        if ($spec === null) {
            return $content;
        }
        $sections = $content['sections'] ?? [];
        $hero = self::heroHeadingId($sections);
        foreach ($sections as $i => $section) {
            if (($section['type'] ?? null) !== 'section') {
                continue;
            }
            $lead = $i === 0;
            $loops = self::countLoops($section);
            $sections[$i] = self::node($section, $spec, $lead, $hero, $loops);
            $sections[$i]['columns'] = self::columns($section['columns'] ?? [], $spec, $lead, $hero, $loops);
        }
        $content['sections'] = $sections;
        $content['motion_theme'] = $look;

        return $content;
    }

    /**
     * @param  list<array<string, mixed>>  $columns
     * @param  array<string, mixed>  $spec
     * @return list<array<string, mixed>>
     */
    private static function columns(array $columns, array $spec, bool $lead, ?string $hero, int &$loops): array
    {
        foreach ($columns as $c => $column) {
            foreach ($column['elements'] ?? [] as $e => $element) {
                $element = self::node($element, $spec, $lead, $hero, $loops);
                if (($element['type'] ?? null) === 'inner_row') {
                    $element['columns'] = self::columns($element['columns'] ?? [], $spec, $lead, $hero, $loops);
                }
                $columns[$c]['elements'][$e] = $element;
            }
        }

        return $columns;
    }

    /**
     * @param  array<string, mixed>  $node
     * @param  array<string, mixed>  $spec
     * @return array<string, mixed>
     */
    private static function node(array $node, array $spec, bool $lead, ?string $hero, int &$loops): array
    {
        if (self::moves($node)) {
            return $node;
        }
        $type = (string) ($node['type'] ?? '');
        $role = $type === 'section' ? 'section' : (in_array($type, self::CARD_HOVER_TYPES, true) ? 'listing' : (self::ROLES[$type] ?? 'other'));
        $still = $lead && ($role === 'section' || in_array($type, self::PICTURE_TYPES, true) || in_array($type, self::HEADING_TYPES, true));

        switch ($role) {
            case 'section':
                $motion = ! $still && $spec['section']['entrance'] !== null ? self::entrance($spec['section']['entrance']) : ['entrance' => 'none'];
                $motion['stagger_children'] = $spec['section']['stagger'];
                if ($motion['entrance'] === 'none' && $spec['section']['easing'] !== 'smooth') {
                    $motion['easing'] = $spec['section']['easing'];
                }
                $node['style']['base']['motion'] = $motion;
                if (! $still && $spec['section']['scroll'] !== null) {
                    $node['style']['base']['scroll'] = $spec['section']['scroll'];
                }
                if ($spec['divider'] !== null) {
                    foreach (['shape_top', 'shape_bottom'] as $shape) {
                        if (is_array($node['props'][$shape] ?? null)) {
                            $node['props'][$shape]['animate'] = $spec['divider'];
                        }
                    }
                }
                break;
            case 'heading':
            case 'text':
            case 'image':
                if (! $still) {
                    $node['style']['base']['motion'] = self::entrance($spec[$role]);
                }
                if ($type === 'heading' && $spec['hero_text'] !== null && ($node['id'] ?? null) === $hero) {
                    $node['props']['text_effect'] = ['type' => $spec['hero_text']];
                }
                break;
            case 'button':
                $node['style']['base']['hover'] = ['effect' => $spec['button']['hover']];
                if ($spec['button']['loop'] !== null && $loops < self::MAX_LOOPS_PER_SECTION) {
                    $node['style']['base']['motion'] = ['entrance' => 'none', 'loop' => $spec['button']['loop']];
                    $loops++;
                }
                break;
            case 'listing':
                $node['props']['card_hover'] = $spec['card_hover'];
                break;
        }

        return $node;
    }

    /**
     * @param  array{entrance: string, duration: int, easing?: string}  $entrance
     * @return array<string, mixed>
     */
    private static function entrance(array $entrance): array
    {
        $motion = ['entrance' => $entrance['entrance'], 'duration' => $entrance['duration'], 'delay' => 0];
        if (($entrance['easing'] ?? 'smooth') !== 'smooth') {
            $motion['easing'] = $entrance['easing'];
        }

        return $motion;
    }

    /**
     * Whether the node already moves (its own motion is kept).
     *
     * @param  array<string, mixed>  $node
     */
    private static function moves(array $node): bool
    {
        $base = $node['style']['base'] ?? [];
        $motion = is_array($base['motion'] ?? null) ? $base['motion'] : null;
        if ($motion !== null && (($motion['entrance'] ?? 'none') !== 'none' || ($motion['loop'] ?? 'none') !== 'none' || ($motion['stagger_children'] ?? 0) > 0)) {
            return true;
        }
        if (($base['hover']['effect'] ?? 'none') !== 'none' || ($base['scroll']['effect'] ?? 'none') !== 'none') {
            return true;
        }
        $props = $node['props'] ?? [];

        return ($props['text_effect']['type'] ?? 'none') !== 'none' || ($props['card_hover'] ?? 'none') !== 'none'
            || ($props['shape_top']['animate'] ?? 'none') !== 'none' || ($props['shape_bottom']['animate'] ?? 'none') !== 'none';
    }

    /**
     * Looping nodes a section already has.
     *
     * @param  array<string, mixed>  $section
     */
    private static function countLoops(array $section): int
    {
        $count = 0;
        array_walk_recursive($section, function (mixed $value, mixed $key) use (&$count) {
            if ($key === 'loop' && is_string($value) && $value !== 'none') {
                $count++;
            }
        });

        return $count;
    }

    /**
     * The page's first heading that may get the hero text effect: none when it sits in the
     * first section and nothing there is a picture (it is probably the largest paint itself).
     *
     * @param  list<array<string, mixed>>  $sections
     */
    private static function heroHeadingId(array $sections): ?string
    {
        foreach ($sections as $i => $section) {
            if (($section['type'] ?? null) !== 'section' || ($section['hidden'] ?? false) === true) {
                continue;
            }
            $heading = null;
            $picture = is_array($section['style']['base']['background']['image'] ?? null) || is_array($section['style']['base']['background']['video'] ?? null);
            self::visit($section['columns'] ?? [], function (array $node) use (&$heading, &$picture) {
                if ($heading === null && ($node['type'] ?? null) === 'heading' && ($node['hidden'] ?? false) !== true) {
                    $heading = $node;
                }
                if (in_array($node['type'] ?? null, self::PICTURE_TYPES, true)) {
                    $picture = true;
                }
            });
            if ($heading === null) {
                continue;
            }

            return $i === 0 && ! $picture ? null : (string) $heading['id'];
        }

        return null;
    }

    /**
     * @param  list<array<string, mixed>>  $columns
     * @param  callable(array<string, mixed>): void  $visit
     */
    private static function visit(array $columns, callable $visit): void
    {
        foreach ($columns as $column) {
            foreach ($column['elements'] ?? [] as $element) {
                $visit($element);
                if (($element['type'] ?? null) === 'inner_row') {
                    self::visit($element['columns'] ?? [], $visit);
                }
            }
        }
    }
}
