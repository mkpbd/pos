<?php

namespace App\Modules\Catalog\Application\Actions;

use App\Modules\Catalog\Infrastructure\Models\Category;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * Categories form a tree of at most MAX_DEPTH levels; a category cannot be
 * moved under itself or one of its descendants.
 */
class SaveCategory
{
    public const MAX_DEPTH = 4;

    public function __construct(private readonly SaveCatalogRecord $save) {}

    /**
     * @param  array{name?: string, parent_id?: ?string, description?: ?string, sort_order?: int, is_active?: bool}  $attributes
     */
    public function __invoke(?Category $category, array $attributes): Category
    {
        return ($this->save)($category ?? new Category, $attributes, 'category', function (Category $category) {
            if (! $category->isDirty('parent_id') || $category->parent_id === null) {
                return;
            }

            // Walk up from the new parent: must not meet the category itself, and must stay shallow.
            $depth = 1;
            $cursor = Category::query()->find($category->parent_id);
            while ($cursor !== null) {
                if ($category->exists && $cursor->id === $category->id) {
                    throw new BusinessRuleViolation('CATEGORY_CYCLE', 'A category cannot be placed under itself or one of its subcategories.');
                }
                $depth++;
                $cursor = $cursor->parent_id ? Category::query()->find($cursor->parent_id) : null;
            }

            $subtreeDepth = $category->exists ? $this->subtreeDepth($category->id) : 1;
            if ($depth + $subtreeDepth - 1 > self::MAX_DEPTH) {
                throw new BusinessRuleViolation('CATEGORY_TOO_DEEP', 'Categories can be nested at most '.self::MAX_DEPTH.' levels deep.');
            }
        });
    }

    private function subtreeDepth(string $categoryId): int
    {
        $children = Category::query()->where('parent_id', $categoryId)->pluck('id');

        return 1 + ($children->isEmpty() ? 0 : $children->map(fn (string $id) => $this->subtreeDepth($id))->max());
    }
}
