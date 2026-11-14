<?php

namespace App\Modules\Storefront\Domain\Builder;

use stdClass;

/**
 * PHP arrays cannot tell an empty object from an empty list: a builder document as API
 * output gets `{}` (not `[]`) for empty maps — `style`, `props` (spacer, inner row) and
 * `translations` — so clients see exactly the v1 format.
 */
final class BuilderJson
{
    /**
     * @param  array<string, mixed>  $document  normalized (or a render tree)
     * @return array<string, mixed>
     */
    public static function present(array $document): array
    {
        $document['sections'] = array_map(fn (array $s) => self::node($s), $document['sections'] ?? []);
        // B8b: a popup's settings.
        if (is_array($document['popup'] ?? null)) {
            $document['popup'] = PopupSettings::present($document['popup']);
        }
        // B9: search & sharing in its canonical key order (jsonb storage sorts keys).
        if (is_array($document['seo'] ?? null)) {
            $document['seo'] = self::seo($document['seo']);
        }

        return $document;
    }

    /**
     * B9: `{title, description, image, noindex, translations}` (`{}` without translations).
     *
     * @param  array<string, mixed>  $seo  normalized
     * @return array<string, mixed>
     */
    public static function seo(array $seo): array
    {
        $translations = is_array($seo['translations'] ?? null) ? $seo['translations'] : [];

        return [
            'title' => $seo['title'] ?? null,
            'description' => $seo['description'] ?? null,
            'image' => $seo['image'] ?? null,
            'noindex' => (bool) ($seo['noindex'] ?? false),
            'translations' => $translations === [] ? new stdClass : $translations,
        ];
    }

    /**
     * @param  array<string, mixed>  $node
     * @return array<string, mixed>
     */
    private static function node(array $node): array
    {
        foreach (['props', 'style', 'translations', 'width'] as $key) {
            if (array_key_exists($key, $node) && $node[$key] === []) {
                $node[$key] = new stdClass;
            }
        }
        foreach (['columns', 'elements'] as $children) {
            if (isset($node[$children]) && is_array($node[$children])) {
                $node[$children] = array_map(fn (array $child) => self::node($child), $node[$children]);
            }
        }

        return $node;
    }
}
