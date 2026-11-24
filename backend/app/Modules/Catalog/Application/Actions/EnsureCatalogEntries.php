<?php

namespace App\Modules\Catalog\Application\Actions;

use App\Modules\Catalog\Infrastructure\Models\Brand;
use App\Modules\Catalog\Infrastructure\Models\Category;

/**
 * ST1: finds a category path ("Drinks > Juice") or a brand by name (case-insensitive) and
 * creates what is missing through the normal save actions (depth rule, audit). Used by the
 * product import, which checks the caller's categories.manage / brands.manage first.
 */
class EnsureCatalogEntries
{
    public function __construct(
        private readonly SaveCategory $saveCategory,
        private readonly SaveCatalogRecord $save,
    ) {}

    /**
     * @param  list<string>  $path  top-level name first
     * @return string the id of the last category
     */
    public function categoryPath(array $path): string
    {
        $parentId = null;
        foreach ($path as $name) {
            $category = Category::query()
                ->when($parentId, fn ($q, string $id) => $q->where('parent_id', $id), fn ($q) => $q->whereNull('parent_id'))
                ->whereRaw('lower(name) = ?', [mb_strtolower(trim($name))])
                ->orderBy('created_at')
                ->first()
                ?? ($this->saveCategory)(null, ['name' => trim($name), 'parent_id' => $parentId]);
            $parentId = $category->id;
        }

        return (string) $parentId;
    }

    public function brand(string $name): string
    {
        $brand = Brand::query()->whereRaw('lower(name) = ?', [mb_strtolower(trim($name))])->first()
            ?? ($this->save)(new Brand, ['name' => trim($name)], 'brand');

        return $brand->id;
    }
}
