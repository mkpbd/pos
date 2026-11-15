<?php

namespace App\Modules\Storefront\Domain\Builder;

/**
 * B12: the order of children per device — `device_order: {tablet?: {<container>: [child ids]},
 * mobile?: {…}}` at the top of a builder document. A container is `root` (the document's
 * sections, global section references included) or a column id (a section's or an inner row's
 * column; its children are the column's elements). Mobile falls back to tablet and tablet to the
 * base (desktop) order, per container.
 *
 * normalize() keeps a canonical form: lists hold exactly the container's current children (ids
 * that are gone dropped, new children appended in base order), containers with fewer than two
 * children, lists equal to the order they would inherit, empty devices and an empty map are
 * dropped; containers in document order (root first). Malformed values are errors
 * (DEVICE_ORDER_INVALID).
 */
final class DeviceOrder
{
    public const DEVICES = ['tablet', 'mobile'];

    public const ROOT = 'root';

    public const ERROR_CODE = 'DEVICE_ORDER_INVALID';

    /**
     * Every container of a (normalized) document with its children in base order — root first,
     * then the columns in document order.
     *
     * @param  array<string, mixed>  $document
     * @return array<string, list<string>>
     */
    public static function containers(array $document): array
    {
        $containers = [self::ROOT => []];
        foreach ($document['sections'] ?? [] as $section) {
            if (is_array($section) && is_string($section['id'] ?? null)) {
                $containers[self::ROOT][] = $section['id'];
            }
        }
        BuilderDocumentSchema::walk($document, function (array $node, string $path, string $kind) use (&$containers) {
            // A column that happens to be called "root" can't have an order of its own.
            if ($kind === 'column' && is_string($node['id'] ?? null) && $node['id'] !== self::ROOT) {
                $containers[$node['id']] = array_values(array_filter(array_map(
                    fn ($element) => is_array($element) && is_string($element['id'] ?? null) ? $element['id'] : null,
                    is_array($node['elements'] ?? null) ? $node['elements'] : [],
                )));
            }
        });

        return $containers;
    }

    /**
     * The canonical device order of a document, or null for none.
     *
     * @param  array<string, mixed>  $document  the normalized document (its sections)
     * @param  callable(string, ?string, string, string): void  $error  (path, node id, message, code)
     * @return array<string, array<string, list<string>>>|null
     */
    public static function normalize(mixed $value, array $document, callable $error): ?array
    {
        if ($value === null) {
            return null;
        }
        if (! is_array($value) || ($value !== [] && array_is_list($value))) {
            $error('device_order', null, 'The order on phones and tablets must be an object.', self::ERROR_CODE);

            return null;
        }
        $lists = [];
        foreach ($value as $device => $map) {
            if (! in_array($device, self::DEVICES, true)) {
                $error("device_order.{$device}", null, 'The order can only be set for tablet and mobile.', self::ERROR_CODE);

                continue;
            }
            if ($map === null) {
                continue;
            }
            if (! is_array($map) || ($map !== [] && array_is_list($map))) {
                $error("device_order.{$device}", null, 'The order on this device must be an object.', self::ERROR_CODE);

                continue;
            }
            foreach ($map as $container => $ids) {
                $container = (string) $container;
                $nodeId = $container === self::ROOT ? null : $container;
                if ($container !== self::ROOT && preg_match('/'.BuilderDocumentSchema::ID_PATTERN.'/', $container) !== 1) {
                    $error("device_order.{$device}.{$container}", null, 'Each order belongs to "root" or a column id.', self::ERROR_CODE);

                    continue;
                }
                if (! is_array($ids) || ! array_is_list($ids) || array_filter($ids, fn ($id) => ! is_string($id)) !== []) {
                    $error("device_order.{$device}.{$container}", $nodeId, 'The order is a list of ids.', self::ERROR_CODE);

                    continue;
                }
                if (count(array_unique($ids)) !== count($ids)) {
                    $error("device_order.{$device}.{$container}", $nodeId, 'An id is listed more than once in the order.', self::ERROR_CODE);

                    continue;
                }
                $lists[$device][$container] = $ids;
            }
        }

        return self::canonical($lists, self::containers($document));
    }

    /**
     * Lists fitted to the containers' children (see the class comment); null when nothing is left.
     *
     * @param  array<string, array<string, list<string>>>  $lists
     * @param  array<string, list<string>>  $containers  container => children in base order
     * @return array<string, array<string, list<string>>>|null
     */
    public static function canonical(array $lists, array $containers): ?array
    {
        $result = [];
        foreach ($containers as $container => $children) {
            if (count($children) < 2) {
                continue;
            }
            $tablet = isset($lists['tablet'][$container]) ? self::fit($lists['tablet'][$container], $children) : null;
            if ($tablet === $children) {
                $tablet = null;
            }
            $mobile = isset($lists['mobile'][$container]) ? self::fit($lists['mobile'][$container], $children) : null;
            if ($mobile === ($tablet ?? $children)) {
                $mobile = null;
            }
            if ($tablet !== null) {
                $result['tablet'][$container] = $tablet;
            }
            if ($mobile !== null) {
                $result['mobile'][$container] = $mobile;
            }
        }
        $ordered = [];
        foreach (self::DEVICES as $device) {
            if (isset($result[$device])) {
                $ordered[$device] = $result[$device];
            }
        }

        return $ordered === [] ? null : $ordered;
    }

    /**
     * The listed ids that are children, then the children not listed (base order).
     *
     * @param  list<string>  $ids
     * @param  list<string>  $children
     * @return list<string>
     */
    public static function fit(array $ids, array $children): array
    {
        $known = array_flip($children);
        $listed = array_values(array_unique(array_filter($ids, fn ($id) => is_string($id) && isset($known[$id]))));
        $seen = array_flip($listed);

        return [...$listed, ...array_values(array_filter($children, fn (string $id) => ! isset($seen[$id])))];
    }

    /**
     * A container's own list for a device, falling back mobile → tablet → null (base order).
     *
     * @param  array<string, mixed>|null  $order
     * @return list<string>|null
     */
    public static function own(?array $order, string $device, string $container): ?array
    {
        $list = $order[$device][$container] ?? null;
        if (is_array($list)) {
            return array_values($list);
        }
        if ($device === 'mobile') {
            return self::own($order, 'tablet', $container);
        }

        return null;
    }

    /**
     * Raw lists from a stored (or expanded) value, without validation — malformed parts skipped.
     *
     * @return array<string, array<string, list<string>>>
     */
    public static function lists(mixed $value): array
    {
        $lists = [];
        if (! is_array($value)) {
            return $lists;
        }
        foreach (self::DEVICES as $device) {
            foreach (is_array($value[$device] ?? null) ? $value[$device] : [] as $container => $ids) {
                if (is_array($ids)) {
                    $lists[$device][(string) $container] = array_values(array_filter($ids, 'is_string'));
                }
            }
        }

        return $lists;
    }
}
