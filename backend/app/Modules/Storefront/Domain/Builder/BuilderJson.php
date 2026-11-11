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

        return $document;
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
