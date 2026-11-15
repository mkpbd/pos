<?php

namespace App\Modules\Storefront\Domain\Builder;

/**
 * B11: what changed between two builder documents (normalized content), for the editor's
 * "compare" list — by node id:
 *
 * - `added` / `removed`: `[{id, type, kind: section|column|element|global_section, parent_id,
 *   label}]` (document order of the side they are on; `label` a short plain text of the node or
 *   null). Children of an added / removed node are listed too.
 * - `changed`: `[{node_id, type, fields: [{field, before, after}]}]` for nodes on both sides —
 *   fields are dotted paths (`props.text`, `props.link.url`, `props.items.<item id>.title`,
 *   `translations.bn.text`, `hidden`, `visibility.mobile`, `width.base`, `schedule.starts_at`,
 *   `ref`); texts are plain (tags removed) and cut to 300 characters; a changed style is one
 *   field `style` with `before` / `after` null (a flag). Page-level changes (`seo`, popup
 *   `popup` settings) are one entry with `node_id` null and `type` `document`.
 * - `moved`: ids of nodes on both sides whose parent changed or whose order among the siblings
 *   both sides share changed (the fewest such nodes).
 * - B12 `device_moved`: `[{id, device: tablet|mobile}]` — nodes out of order on that device
 *   (deviceMoved()); `device_order` is not a page-level change.
 */
final class BuilderDiff
{
    public const MAX_TEXT = 300;

    public const MAX_FIELDS = 40;

    /** Keys that hold children, not values of the node itself. */
    private const CHILD_KEYS = ['columns', 'elements'];

    /** Node keys compared as one "style changed" flag. */
    private const STYLE_KEYS = ['style'];

    /** Props keys whose values read as labels. */
    private const LABEL_PROPS = ['text', 'title', 'heading', 'label', 'name', 'alt', 'html', 'question', 'caption'];

    /**
     * @param  array<string, mixed>  $from
     * @param  array<string, mixed>  $to
     * @return array{added: list<array<string, mixed>>, removed: list<array<string, mixed>>, changed: list<array<string, mixed>>, moved: list<string>, device_moved: list<array{id: string, device: string}>}
     */
    public static function compare(array $from, array $to): array
    {
        $before = self::index($from);
        $after = self::index($to);

        $added = [];
        foreach ($after as $id => $entry) {
            if (! isset($before[$id])) {
                $added[] = self::describe($entry);
            }
        }
        $removed = [];
        foreach ($before as $id => $entry) {
            if (! isset($after[$id])) {
                $removed[] = self::describe($entry);
            }
        }

        $changed = [];
        $documentFields = self::fields(self::documentValues($from), self::documentValues($to));
        if ($documentFields !== []) {
            $changed[] = ['node_id' => null, 'type' => 'document', 'fields' => $documentFields];
        }
        foreach ($after as $id => $entry) {
            if (! isset($before[$id])) {
                continue;
            }
            $fields = self::fields($before[$id]['values'], $entry['values']);
            if ($fields !== []) {
                $changed[] = ['node_id' => (string) $id, 'type' => $entry['type'], 'fields' => $fields];
            }
        }

        return [
            'added' => $added,
            'removed' => $removed,
            'changed' => $changed,
            'moved' => self::moved($before, $after),
            'device_moved' => self::deviceMoved($from, $to, $after),
        ];
    }

    /**
     * B12: nodes out of order on a tablet or phone — in a container both sides have, among the
     * children both sides share, by the effective order on that device; only where the device has
     * an order of its own on either side (a phone that follows the tablet is not listed again).
     *
     * @param  array<string, mixed>  $from
     * @param  array<string, mixed>  $to
     * @param  array<string, mixed>  $after  the "after" index (document order)
     * @return list<array{id: string, device: string}>
     */
    private static function deviceMoved(array $from, array $to, array $after): array
    {
        $listsBefore = DeviceOrder::lists($from['device_order'] ?? null);
        $listsAfter = DeviceOrder::lists($to['device_order'] ?? null);
        if ($listsBefore === [] && $listsAfter === []) {
            return [];
        }
        $containersBefore = DeviceOrder::containers($from);
        $containersAfter = DeviceOrder::containers($to);

        $moved = [];
        foreach (DeviceOrder::DEVICES as $device) {
            foreach ($containersAfter as $container => $children) {
                if (! isset($containersBefore[$container]) || (! isset($listsBefore[$device][$container]) && ! isset($listsAfter[$device][$container]))) {
                    continue;
                }
                $old = DeviceOrder::fit(DeviceOrder::own($listsBefore, $device, $container) ?? [], $containersBefore[$container]);
                $new = DeviceOrder::fit(DeviceOrder::own($listsAfter, $device, $container) ?? [], $children);
                $shared = array_flip(array_intersect($old, $new));
                $old = array_values(array_filter($old, fn (string $id) => isset($shared[$id])));
                $new = array_values(array_filter($new, fn (string $id) => isset($shared[$id])));
                if ($old === $new) {
                    continue;
                }
                $kept = array_flip(self::lcs($old, $new));
                foreach ($new as $id) {
                    if (! isset($kept[$id])) {
                        $moved[$id][$device] = true;
                    }
                }
            }
        }

        $result = [];
        foreach (array_map('strval', array_keys($after)) as $id) {
            foreach (DeviceOrder::DEVICES as $device) {
                if (isset($moved[$id][$device])) {
                    $result[] = ['id' => $id, 'device' => $device];
                }
            }
        }

        return $result;
    }

    /**
     * Every node by id with its parent, its kind and type, and its own values (no children).
     *
     * @param  array<string, mixed>  $document
     * @return array<string, array{id: string, type: string, kind: string, parent_id: ?string, node: array<string, mixed>, values: array<string, mixed>}>
     */
    private static function index(array $document): array
    {
        $index = [];
        foreach (array_values(is_array($document['sections'] ?? null) ? $document['sections'] : []) as $section) {
            self::visit($section, null, $index);
        }

        return $index;
    }

    /**
     * @param  array<string, array<string, mixed>>  $index
     */
    private static function visit(mixed $node, ?string $parentId, array &$index): void
    {
        if (! is_array($node) || ! is_string($node['id'] ?? null) || isset($index[$node['id']])) {
            return;
        }
        $type = is_string($node['type'] ?? null) ? $node['type'] : 'element';
        $kind = match (true) {
            $type === BuilderDocumentSchema::GLOBAL_SECTION => BuilderDocumentSchema::GLOBAL_SECTION,
            $type === 'section' => 'section',
            $type === 'column' => 'column',
            default => 'element',
        };
        $values = array_diff_key($node, array_flip([...self::CHILD_KEYS, 'id', 'type']));
        $index[$node['id']] = ['id' => $node['id'], 'type' => $type, 'kind' => $kind, 'parent_id' => $parentId, 'node' => $node, 'values' => $values];

        foreach (self::children($node) as $child) {
            self::visit($child, $node['id'], $index);
        }
    }

    /**
     * @param  array<string, mixed>  $node
     * @return list<mixed>
     */
    private static function children(array $node): array
    {
        $children = [];
        foreach (self::CHILD_KEYS as $key) {
            if (is_array($node[$key] ?? null)) {
                array_push($children, ...array_values($node[$key]));
            }
        }

        return $children;
    }

    /**
     * @param  array{id: string, type: string, kind: string, parent_id: ?string, node: array<string, mixed>}  $entry
     * @return array{id: string, type: string, kind: string, parent_id: ?string, label: ?string}
     */
    private static function describe(array $entry): array
    {
        return ['id' => $entry['id'], 'type' => $entry['type'], 'kind' => $entry['kind'], 'parent_id' => $entry['parent_id'], 'label' => self::label($entry['node'])];
    }

    /**
     * @param  array<string, mixed>  $node
     */
    private static function label(array $node): ?string
    {
        $props = is_array($node['props'] ?? null) ? $node['props'] : [];
        foreach (self::LABEL_PROPS as $key) {
            $value = $props[$key] ?? null;
            if (is_string($value)) {
                $text = self::plain($value, 60);
                if ($text !== '') {
                    return $text;
                }
            }
        }

        return null;
    }

    /**
     * Page-level values: everything but the sections and the schema version (SEO, popup settings).
     *
     * @param  array<string, mixed>  $document
     * @return array<string, mixed>
     */
    private static function documentValues(array $document): array
    {
        // B12: the order on tablets and phones is reported as `device_moved`.
        return array_diff_key($document, array_flip(['sections', 'schema_version', 'device_order']));
    }

    /**
     * @param  array<string, mixed>  $before
     * @param  array<string, mixed>  $after
     * @return list<array{field: string, before: mixed, after: mixed}>
     */
    private static function fields(array $before, array $after): array
    {
        $fields = [];
        foreach (self::STYLE_KEYS as $key) {
            if (self::canonical($before[$key] ?? null) !== self::canonical($after[$key] ?? null)) {
                $fields[] = ['field' => $key, 'before' => null, 'after' => null];
            }
            unset($before[$key], $after[$key]);
        }

        $a = self::flatten($before);
        $b = self::flatten($after);
        foreach (array_keys($a + $b) as $path) {
            $old = $a[$path] ?? null;
            $new = $b[$path] ?? null;
            if ($old === $new) {
                continue;
            }
            if (count($fields) >= self::MAX_FIELDS) {
                break;
            }
            $fields[] = ['field' => (string) $path, 'before' => self::value($old), 'after' => self::value($new)];
        }

        return $fields;
    }

    /**
     * Leaves by dotted path; lists of records with ids are keyed by id, lists of plain values
     * are one leaf.
     *
     * @return array<string, mixed>
     */
    private static function flatten(mixed $value, string $prefix = ''): array
    {
        if (! is_array($value)) {
            return $prefix === '' ? [] : [$prefix => $value];
        }
        if ($value === []) {
            return $prefix === '' ? [] : [$prefix => null];
        }
        if (array_is_list($value)) {
            $records = array_filter($value, fn ($item) => is_array($item) && is_string($item['id'] ?? null));
            if (count($records) !== count($value)) {
                return $prefix === '' ? [] : [$prefix => self::canonical($value)];
            }
            $keyed = [];
            foreach ($value as $item) {
                $keyed[$item['id']] = array_diff_key($item, ['id' => true]);
            }
            $value = $keyed;
        }

        $leaves = [];
        foreach ($value as $key => $child) {
            $path = $prefix === '' ? (string) $key : $prefix.'.'.$key;
            foreach (self::flatten($child, $path) as $leafPath => $leaf) {
                $leaves[$leafPath] = $leaf;
            }
        }

        return $leaves;
    }

    private static function value(mixed $value): mixed
    {
        if (is_string($value)) {
            return self::plain($value, self::MAX_TEXT);
        }
        if (is_array($value)) {
            $json = (string) json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

            return mb_strlen($json) > self::MAX_TEXT ? mb_substr($json, 0, self::MAX_TEXT - 1).'…' : $value;
        }

        return $value;
    }

    private static function plain(string $text, int $max): string
    {
        if (str_contains($text, '<')) {
            $text = html_entity_decode(strip_tags(str_replace(['<br>', '<br/>', '<br />', '</p>', '</li>'], ' ', $text)), ENT_QUOTES | ENT_HTML5);
        }
        $text = trim((string) preg_replace('/\s+/u', ' ', $text));

        return mb_strlen($text) > $max ? mb_substr($text, 0, $max - 1).'…' : $text;
    }

    /**
     * Nodes on both sides that moved: another parent, or out of order among the siblings both
     * sides share (those outside a longest common subsequence).
     *
     * @param  array<string, array{parent_id: ?string}>  $before
     * @param  array<string, array{parent_id: ?string}>  $after
     * @return list<string>
     */
    private static function moved(array $before, array $after): array
    {
        $moved = [];
        $orderBefore = [];
        $orderAfter = [];
        foreach ($after as $id => $entry) {
            if (! isset($before[$id])) {
                continue;
            }
            if ($before[$id]['parent_id'] !== $entry['parent_id']) {
                $moved[(string) $id] = true;

                continue;
            }
            $orderAfter[$entry['parent_id'] ?? ''][] = (string) $id;
        }
        foreach ($before as $id => $entry) {
            if (isset($after[$id]) && ! isset($moved[(string) $id])) {
                $orderBefore[$entry['parent_id'] ?? ''][] = (string) $id;
            }
        }
        foreach ($orderAfter as $parent => $ids) {
            $old = $orderBefore[$parent] ?? [];
            if ($old === $ids) {
                continue;
            }
            $kept = array_flip(self::lcs($old, $ids));
            foreach ($ids as $id) {
                if (! isset($kept[$id])) {
                    $moved[$id] = true;
                }
            }
        }

        // In the "after" document order.
        return array_values(array_filter(array_map('strval', array_keys($after)), fn (string $id) => isset($moved[$id])));
    }

    /**
     * @param  list<string>  $a
     * @param  list<string>  $b
     * @return list<string>
     */
    private static function lcs(array $a, array $b): array
    {
        $n = count($a);
        $m = count($b);
        $table = array_fill(0, $n + 1, array_fill(0, $m + 1, 0));
        for ($i = $n - 1; $i >= 0; $i--) {
            for ($j = $m - 1; $j >= 0; $j--) {
                $table[$i][$j] = $a[$i] === $b[$j] ? $table[$i + 1][$j + 1] + 1 : max($table[$i + 1][$j], $table[$i][$j + 1]);
            }
        }
        $result = [];
        for ($i = 0, $j = 0; $i < $n && $j < $m;) {
            if ($a[$i] === $b[$j]) {
                $result[] = $a[$i];
                $i++;
                $j++;
            } elseif ($table[$i + 1][$j] >= $table[$i][$j + 1]) {
                $i++;
            } else {
                $j++;
            }
        }

        return $result;
    }

    private static function canonical(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        $value = array_map(fn ($v) => self::canonical($v), $value);
        if (! array_is_list($value)) {
            ksort($value);
        }

        return $value;
    }
}
