<?php

namespace App\Modules\OnlineCatalog\Domain;

/**
 * The catalog's category tree and the storefront's view of it. Only visible categories
 * appear on the storefront; a visible category under a hidden one is attached to its
 * nearest visible ancestor (or becomes a root), so hiding a level never hides what is
 * below it. Product counts always follow the real tree.
 */
final class CategoryTree
{
    /** @var array<string, array{id: string, parent_id: ?string, name: string, sort_order: int, is_active: bool}> */
    private array $nodes = [];

    /** @var array<string, list<string>> */
    private array $children = [];

    /** @var array<string, true> */
    private array $visible;

    /**
     * @param  list<array{id: string, parent_id: ?string, name: string, sort_order: int, is_active: bool}>  $categories  ordered by sort order and name
     * @param  list<string>  $visibleIds  categories shown on the storefront
     */
    public function __construct(array $categories, array $visibleIds = [])
    {
        foreach ($categories as $category) {
            $this->nodes[$category['id']] = $category;
        }
        foreach ($categories as $category) {
            $parent = $category['parent_id'] !== null && isset($this->nodes[$category['parent_id']]) ? $category['parent_id'] : '';
            $this->children[$parent][] = $category['id'];
        }
        $this->visible = array_fill_keys($visibleIds, true);
    }

    public function has(string $id): bool
    {
        return isset($this->nodes[$id]);
    }

    /**
     * @return array{id: string, parent_id: ?string, name: string, sort_order: int, is_active: bool}|null
     */
    public function node(string $id): ?array
    {
        return $this->nodes[$id] ?? null;
    }

    public function isVisible(string $id): bool
    {
        return isset($this->visible[$id]);
    }

    /**
     * The category and every category below it in the real tree.
     *
     * @return list<string>
     */
    public function withDescendants(string $id): array
    {
        if (! isset($this->nodes[$id])) {
            return [];
        }
        $ids = [$id];
        foreach ($this->children[$id] ?? [] as $child) {
            array_push($ids, ...$this->withDescendants($child));
        }

        return $ids;
    }

    /**
     * Every category in tree order (depth-first) with its depth (0 = root).
     *
     * @return list<array{id: string, parent_id: ?string, name: string, sort_order: int, is_active: bool, depth: int}>
     */
    public function flatten(): array
    {
        $walk = function (string $parent, int $depth) use (&$walk): array {
            $rows = [];
            foreach ($this->children[$parent] ?? [] as $id) {
                $rows[] = $this->nodes[$id] + ['depth' => $depth];
                array_push($rows, ...$walk($id, $depth + 1));
            }

            return $rows;
        };

        return $walk('', 0);
    }

    /**
     * Visible children of a visible category (or the visible roots for null), skipping
     * hidden levels in between.
     *
     * @return list<string>
     */
    public function visibleChildren(?string $id): array
    {
        $result = [];
        foreach ($this->children[$id ?? ''] ?? [] as $child) {
            if ($this->isVisible($child)) {
                $result[] = $child;
            } else {
                array_push($result, ...$this->visibleChildren($child));
            }
        }

        return $result;
    }

    /**
     * P1b: the category and its ancestors in the real tree (visible or not), nearest first —
     * the order in which category-targeted product page zones apply.
     *
     * @return list<string>
     */
    public function selfAndAncestors(string $id): array
    {
        $ids = [];
        $cursor = isset($this->nodes[$id]) ? $id : null;
        while ($cursor !== null && isset($this->nodes[$cursor]) && ! in_array($cursor, $ids, true)) {
            $ids[] = $cursor;
            $cursor = $this->nodes[$cursor]['parent_id'];
        }

        return $ids;
    }

    /**
     * Visible ancestors from the root down to (excluding) the category.
     *
     * @return list<string>
     */
    public function visibleAncestors(string $id): array
    {
        $ancestors = [];
        $cursor = $this->nodes[$id]['parent_id'] ?? null;
        while ($cursor !== null && isset($this->nodes[$cursor])) {
            if ($this->isVisible($cursor)) {
                array_unshift($ancestors, $cursor);
            }
            $cursor = $this->nodes[$cursor]['parent_id'];
        }

        return $ancestors;
    }
}
