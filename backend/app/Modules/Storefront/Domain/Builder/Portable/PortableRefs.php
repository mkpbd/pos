<?php

namespace App\Modules\Storefront\Domain\Builder\Portable;

use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use Illuminate\Support\Str;

/**
 * B16: record references of a builder page file (pure). In an exported page every record id the
 * page refers to (media, products, categories, brands, banners, menus, blog categories,
 * promotions) is replaced by a reference string `@ref:<type>:<n>` explained in the file's
 * `media` / `references`; on import each reference becomes the id of the matching record of the
 * importing store, or is dropped:
 *
 * - a list item that holds a missing reference leaves the list (one product of a hand-picked
 *   grid, one hotspot, one category of a strip);
 * - any other node holding one (an image element without its photo, a spotlight without its
 *   product) is dropped as a whole, and counted per element type;
 * - the page's share image is cleared instead of dropping anything.
 */
final class PortableRefs
{
    public const TYPES = ['media', 'product', 'category', 'brand', 'banner', 'menu', 'blog_category', 'promotion'];

    public const PATTERN = '/^@ref:(media|product|category|brand|banner|menu|blog_category|promotion):([1-9][0-9]{0,5})$/';

    public static function make(string $type, int $n): string
    {
        return "@ref:{$type}:{$n}";
    }

    /**
     * Every string equal to a key of `$refs` (id => reference) replaced by its reference.
     */
    public static function encode(mixed $value, array $refs): mixed
    {
        if (is_string($value)) {
            return $refs[$value] ?? $value;
        }
        if (! is_array($value)) {
            return $value;
        }
        foreach ($value as $key => $child) {
            $value[$key] = self::encode($child, $refs);
        }

        return $value;
    }

    /**
     * References replaced by the importing store's ids (`$ids`: reference => id, or null when
     * missing); a reference not in `$ids` counts as missing. Returns the content and the dropped
     * elements by type.
     *
     * @param  array<string, mixed>  $content
     * @param  array<string, ?string>  $ids
     * @return array{0: array<string, mixed>, 1: array<string, int>}
     */
    public static function decode(array $content, array $ids): array
    {
        $dropped = [];
        if (is_array($content['seo']['image'] ?? null)) {
            [$image, $missing] = self::resolve($content['seo']['image'], $ids, $dropped);
            $content['seo']['image'] = $missing ? null : $image;
        }
        foreach ($content as $key => $value) {
            if ($key === 'seo') {
                continue;
            }
            [$resolved, $missing] = self::resolve($value, $ids, $dropped);
            if ($missing) {
                unset($content[$key]);
            } else {
                $content[$key] = $resolved;
            }
        }

        return [$content, $dropped];
    }

    /**
     * Removes the nodes (sections, columns, elements, at any depth) with these ids, counting them.
     *
     * @param  array<string, mixed>  $content
     * @param  list<string>  $nodeIds
     * @param  array<string, int>  $dropped
     * @return array<string, mixed>
     */
    public static function removeNodes(array $content, array $nodeIds, array &$dropped): array
    {
        $remove = array_flip($nodeIds);
        $walk = function (array $nodes, string $kind) use (&$walk, $remove, &$dropped): array {
            $kept = [];
            foreach ($nodes as $node) {
                if (is_array($node) && is_string($node['id'] ?? null) && isset($remove[$node['id']])) {
                    $type = $kind === 'element' ? (string) ($node['type'] ?? 'element') : $kind;
                    $dropped[$type] = ($dropped[$type] ?? 0) + 1;

                    continue;
                }
                if (is_array($node)) {
                    $children = self::children($node, $kind);
                    if ($children !== null) {
                        $node[$children[0]] = $walk($node[$children[0]], $children[1]);
                    }
                }
                $kept[] = $node;
            }

            return $kept;
        };
        if (is_array($content['sections'] ?? null)) {
            $content['sections'] = $walk($content['sections'], 'section');
        }

        return $content;
    }

    /**
     * Elements of a type removed everywhere (e.g. custom HTML without the permission), counted.
     *
     * @param  array<string, mixed>  $content
     * @param  array<string, int>  $dropped
     * @return array<string, mixed>
     */
    public static function removeElementType(array $content, string $type, array &$dropped): array
    {
        $ids = [];
        self::visit($content, function (array $node, string $kind) use ($type, &$ids) {
            if ($kind === 'element' && ($node['type'] ?? null) === $type && is_string($node['id'] ?? null)) {
                $ids[] = $node['id'];
            }
        });

        return $ids === [] ? $content : self::removeNodes($content, $ids, $dropped);
    }

    /**
     * Gives repeated node ids (a global section shown twice, inlined) fresh ids.
     *
     * @param  array<string, mixed>  $content
     * @return array<string, mixed>
     */
    public static function uniqueIds(array $content): array
    {
        $seen = [];
        $fix = function (array $node, string $kind) use (&$fix, &$seen): array {
            $id = $node['id'] ?? null;
            if (is_string($id) && $id !== '') {
                if (isset($seen[$id])) {
                    do {
                        $node['id'] = $id[0].'_'.Str::lower(Str::random(10));
                    } while (isset($seen[$node['id']]));
                }
                $seen[$node['id']] = true;
            }
            $children = self::children($node, $kind);
            if ($children !== null) {
                foreach ($node[$children[0]] as $i => $child) {
                    if (is_array($child)) {
                        $node[$children[0]][$i] = $fix($child, $children[1]);
                    }
                }
            }

            return $node;
        };
        foreach ($content['sections'] ?? [] as $i => $section) {
            if (is_array($section)) {
                $content['sections'][$i] = $fix($section, 'section');
            }
        }

        return $content;
    }

    /**
     * Calls `$visit(node, kind)` for every section, column and element.
     *
     * @param  array<string, mixed>  $content
     * @param  callable(array<string, mixed>, string): void  $visit
     */
    public static function visit(array $content, callable $visit): void
    {
        $walk = function (array $nodes, string $kind) use (&$walk, $visit): void {
            foreach ($nodes as $node) {
                if (! is_array($node)) {
                    continue;
                }
                $visit($node, $kind);
                $children = self::children($node, $kind);
                if ($children !== null) {
                    $walk($node[$children[0]], $children[1]);
                }
            }
        };
        $walk(is_array($content['sections'] ?? null) ? $content['sections'] : [], 'section');
    }

    /**
     * @param  array<string, mixed>  $node
     * @return array{0: string, 1: string}|null the children's key and kind
     */
    private static function children(array $node, string $kind): ?array
    {
        $children = match ($kind) {
            'section' => ['columns', 'column'],
            'column' => ['elements', 'element'],
            default => ElementRegistry::children((string) ($node['type'] ?? '')) === 'columns' ? ['columns', 'column'] : null,
        };

        return $children !== null && is_array($node[$children[0]] ?? null) && array_is_list($node[$children[0]]) ? $children : null;
    }

    /**
     * @param  array<string, ?string>  $ids
     * @param  array<string, int>  $dropped
     * @return array{0: mixed, 1: bool} the value and whether it holds a missing reference
     */
    private static function resolve(mixed $value, array $ids, array &$dropped): array
    {
        if (is_string($value)) {
            if (preg_match(self::PATTERN, $value) !== 1) {
                return [$value, false];
            }
            $id = $ids[$value] ?? null;

            return $id === null ? [null, true] : [$id, false];
        }
        if (! is_array($value)) {
            return [$value, false];
        }
        if (array_is_list($value)) {
            $kept = [];
            foreach ($value as $item) {
                [$resolved, $missing] = self::resolve($item, $ids, $dropped);
                if ($missing) {
                    if (is_array($item) && is_string($item['id'] ?? null) && is_string($item['type'] ?? null)) {
                        $dropped[$item['type']] = ($dropped[$item['type']] ?? 0) + 1;
                    } elseif (is_array($item) && is_string($item['id'] ?? null) && is_array($item['elements'] ?? null)) {
                        $dropped['column'] = ($dropped['column'] ?? 0) + 1;
                    }

                    continue;
                }
                $kept[] = $resolved;
            }

            return [$kept, false];
        }
        foreach ($value as $key => $child) {
            [$resolved, $missing] = self::resolve($child, $ids, $dropped);
            if ($missing) {
                return [null, true];
            }
            $value[$key] = $resolved;
        }

        return [$value, false];
    }
}
