<?php

namespace App\Modules\Storefront\Application\Queries;

use App\Modules\Cms\Application\Contracts\BlogDirectory;
use App\Modules\Cms\Application\Contracts\PageDirectory;
use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Domain\Translations;
use App\Modules\Storefront\Domain\MenuItemType;
use App\Modules\Storefront\Infrastructure\Models\Menu;
use App\Modules\Storefront\Infrastructure\Models\MenuItem;
use Illuminate\Support\Collection;

/**
 * Menus as the storefront draws them (extracted from the bootstrap in B4, so the builder's menu
 * elements serve exactly the same trees): visible items only, in sort order, a hidden parent
 * hiding its branch; items linking to a page, category, brand, blog category or blog post that
 * is not visible on the storefront (any more) are left out; labels in the request's language.
 *
 * An item: `{id, label, url, open_in_new_tab, is_mega, mega_columns, image, children}`.
 */
class MenuTrees
{
    public function __construct(
        private readonly PageDirectory $pages,
        private readonly StorefrontCatalog $catalog,
        private readonly BlogDirectory $blog,
        private readonly LocaleContext $locale,
        private readonly MediaLibrary $media,
    ) {}

    /**
     * Menus with only their visible items loaded.
     *
     * @param  list<string>|null  $ids  null = the active menus (bootstrap); else these menus, active or not
     * @return Collection<int, Menu>
     */
    public function load(?array $ids): Collection
    {
        $query = Menu::query()->with(['items' => fn ($q) => $q->where('is_visible', true)]);
        if ($ids === null) {
            return $query->where('is_active', true)->get();
        }

        return $ids === [] ? new Collection : $query->whereIn('id', $ids)->get();
    }

    /**
     * Item media ids of the menus (item images).
     *
     * @param  Collection<int, Menu>  $menus
     * @return list<string>
     */
    public static function mediaIds(Collection $menus): array
    {
        return $menus->flatMap(fn (Menu $menu) => $menu->items->pluck('image_media_id')->filter())->values()->all();
    }

    /**
     * The tree of every menu, keyed by menu id.
     *
     * @param  Collection<int, Menu>  $menus  with their visible items loaded
     * @param  (callable(?string): ?array<string, mixed>)|null  $ref  media id → media ref (resolved here when null)
     * @return array<string, list<array<string, mixed>>>
     */
    public function trees(Collection $menus, ?callable $ref = null): array
    {
        if ($ref === null) {
            $refs = $this->media->refs(array_values(array_unique(self::mediaIds($menus))));
            $ref = fn (?string $id) => $id !== null ? ($refs[$id] ?? null) : null;
        }

        $targetIds = fn (MenuItemType $type) => $menus->flatMap(fn (Menu $menu) => $menu->items->where('type', $type)->pluck('target_id'))->filter()->unique()->values()->all();
        $links = [];
        foreach ($this->pages->visible($targetIds(MenuItemType::Page)) as $id => $page) {
            $links[MenuItemType::Page->value][$id] = '/pages/'.$page['slug'];
        }
        foreach ($this->catalog->visibleCategories($targetIds(MenuItemType::Category)) as $id => $category) {
            $links[MenuItemType::Category->value][$id] = '/category/'.$category['slug'];
        }
        foreach ($this->catalog->visibleBrands($targetIds(MenuItemType::Brand)) as $id => $brand) {
            $links[MenuItemType::Brand->value][$id] = '/brand/'.$brand['slug'];
        }
        // E11: blog links — the index, categories that are not deleted, readable posts.
        $links[MenuItemType::Blog->value][''] = '/blog';
        foreach ($this->blog->categories($targetIds(MenuItemType::BlogCategory)) as $id => $category) {
            $links[MenuItemType::BlogCategory->value][$id] = '/blog/category/'.$category['slug'];
        }
        foreach ($this->blog->visiblePosts($targetIds(MenuItemType::BlogPost)) as $id => $post) {
            $links[MenuItemType::BlogPost->value][$id] = '/blog/'.$post['slug'];
        }

        $locale = $this->locale->current();
        $trees = [];
        foreach ($menus as $menu) {
            $trees[$menu->id] = $this->tree($menu->items, null, $ref, $links, $locale);
        }

        return $trees;
    }

    /**
     * @param  Collection<int, MenuItem>  $items
     * @param  array<string, array<string, string>>  $links  item type => target id => storefront path
     * @return list<array<string, mixed>>
     */
    private function tree(Collection $items, ?string $parentId, callable $ref, array $links, string $locale): array
    {
        return $items
            ->where('parent_id', $parentId)
            ->sortBy('sort_order')
            ->filter(fn (MenuItem $item) => $item->type === MenuItemType::Custom || isset($links[$item->type->value][$item->target_id ?? '']))
            ->map(fn (MenuItem $item) => [
                'id' => $item->id,
                'label' => Translations::pick($item, 'label', $locale),
                'url' => $item->type === MenuItemType::Custom ? $item->url : $links[$item->type->value][$item->target_id ?? ''],
                'open_in_new_tab' => $item->open_in_new_tab,
                'is_mega' => $item->is_mega,
                'mega_columns' => $item->mega_columns,
                'image' => $ref($item->image_media_id),
                'children' => $this->tree($items, $item->id, $ref, $links, $locale),
            ])
            ->values()
            ->all();
    }
}
