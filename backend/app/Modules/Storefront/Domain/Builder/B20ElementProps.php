<?php

namespace App\Modules\Storefront\Domain\Builder;

/**
 * B20: props of the animated graphics for BuilderDocumentSchema, like the other normalizers:
 * missing keys take the registry defaults, unknown keys dropped, each value checked against its
 * limit.
 *
 * - animated_icon: a drawn line icon of the set (ElementRegistry::ANIMATED_ICON_GROUPS) with an
 *   animation, when it plays, size, line weight, colour (a theme role, or `custom` with `color`
 *   `#rrggbb` — `color` is kept only then), a background shape and `label` (its accessible name;
 *   empty = decorative).
 * - illustration: an animated scene (ElementRegistry::ILLUSTRATIONS) with when it plays, size,
 *   align, palette and `alt` (empty = decorative).
 */
final class B20ElementProps extends ElementProps
{
    /**
     * @param  array<string, mixed>  $props
     * @return array<string, mixed>
     */
    public function normalize(string $type, array $props): array
    {
        $this->start($type, $props);
        $max = ElementRegistry::TRANSLATABLE[$type] ?? [];

        return match ($type) {
            'animated_icon' => $this->animatedIcon($max['label']),
            'illustration' => [
                'name' => $this->enum('name', array_keys(ElementRegistry::ILLUSTRATIONS)),
                'play' => $this->enum('play', ElementRegistry::ILLUSTRATION_PLAYS),
                'size' => $this->enum('size', ElementRegistry::ILLUSTRATION_SIZES),
                'align' => $this->enum('align', ElementRegistry::ALIGNS),
                'palette' => $this->enum('palette', ElementRegistry::ILLUSTRATION_PALETTES),
                'alt' => $this->text($this->raw('alt'), 'alt', 0, $max['alt']),
            ],
            default => [],
        };
    }

    /**
     * @return array<string, mixed>
     */
    private function animatedIcon(int $labelMax): array
    {
        $name = $this->raw('name');
        if (! is_string($name) || ! in_array($name, ElementRegistry::animatedIconNames(), true)) {
            $this->fail('name', 'Choose an icon of the animated icon set.');
            $name = $this->defaults['name'];
        }
        $result = [
            'name' => $name,
            'animation' => $this->enum('animation', ElementRegistry::ANIMATED_ICON_ANIMATIONS),
            'trigger' => $this->enum('trigger', ElementRegistry::ANIMATED_ICON_TRIGGERS),
            'size' => $this->int('size', ElementRegistry::ANIMATED_ICON_SIZE),
            'stroke' => $this->int('stroke', ElementRegistry::ANIMATED_ICON_STROKE),
            'color_role' => $this->enum('color_role', ElementRegistry::ANIMATED_ICON_COLOR_ROLES),
            'background' => $this->enum('background', ElementRegistry::ANIMATED_ICON_BACKGROUNDS),
            'label' => $this->text($this->raw('label'), 'label', 0, $labelMax),
        ];
        // A custom colour needs its hex; with a theme role a colour is not kept.
        if ($result['color_role'] === 'custom') {
            $color = $this->props['color'] ?? null;
            if (is_string($color) && preg_match('/^#[0-9a-fA-F]{6}$/', $color) === 1) {
                $result['color'] = strtolower($color);
            } else {
                $this->fail('color', 'Choose a colour as #rrggbb, or use a theme colour.');
            }
        }

        return $result;
    }
}
