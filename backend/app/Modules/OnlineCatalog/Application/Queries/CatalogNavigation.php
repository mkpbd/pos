<?php

namespace App\Modules\OnlineCatalog\Application\Queries;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\OnlineCatalog\Infrastructure\Models\BrandListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\CategoryListing;
use App\Modules\OnlineCatalog\Infrastructure\ReadModels\CatalogReadModel;
use App\Modules\Shared\Domain\PlainText;
use DateTimeInterface;
use Illuminate\Database\Eloquent\ModelNotFoundException;

/**
 * Category and brand pages, the category tree, search suggestions and the category/brand
 * strips of the homepage. Only categories and brands with a visible listing and an active
 * record exist on the storefront.
 */
class CatalogNavigation
{
    public const SUGGEST_PRODUCTS = 6;

    public const SUGGEST_CATEGORIES = 4;

    /** Meta descriptions built from text are cut to this many characters. */
    public const META_DESCRIPTION_LENGTH = 160;

    /** @var array<string, int>|null */
    private ?array $counts = null;

    public function __construct(
        private readonly CatalogReadModel $catalog,
        private readonly MediaLibrary $media,
    ) {}

    /**
     * Visible categories as a tree with live product counts (subcategories included).
     *
     * @return list<array<string, mixed>>
     */
    public function categoryTree(): array
    {
        $tree = $this->catalog->categoryTree();
        $refs = $this->refs(array_map(fn (CategoryListing $l) => $l->image_media_id, $this->catalog->categoryListings()));

        $build = function (?string $parent) use (&$build, $tree, $refs): array {
            return array_map(fn (string $id) => [
                'id' => $id,
                'slug' => $this->catalog->categoryListings()[$id]->slug,
                'name' => $tree->node($id)['name'],
                'image' => $refs[$this->catalog->categoryListings()[$id]->image_media_id] ?? null,
                'product_count' => $this->productCount($id),
                'children' => $build($id),
            ], $tree->visibleChildren($parent));
        };

        return $build(null);
    }

    /**
     * @return array<string, mixed>
     */
    public function category(string $slug): array
    {
        $id = $this->categoryIdBySlug($slug) ?? throw (new ModelNotFoundException)->setModel(CategoryListing::class);
        $tree = $this->catalog->categoryTree();
        $listing = $this->catalog->categoryListings()[$id];
        $children = $tree->visibleChildren($id);
        $refs = $this->refs([$listing->image_media_id, $listing->banner_media_id,
            ...array_map(fn (string $c) => $this->catalog->categoryListings()[$c]->image_media_id, $children)]);

        return [
            'id' => $id,
            'slug' => $listing->slug,
            'name' => $tree->node($id)['name'],
            'description_html' => $listing->description_html,
            'image' => $refs[$listing->image_media_id] ?? null,
            'banner' => $refs[$listing->banner_media_id] ?? null,
            'seo' => ['title' => $listing->seo_title ?? $tree->node($id)['name'], 'description' => $listing->seo_description],
            'breadcrumbs' => [
                ['name' => 'Home', 'url' => '/'],
                ...array_map(fn (string $a) => ['name' => $tree->node($a)['name'], 'url' => '/category/'.$this->catalog->categoryListings()[$a]->slug], $tree->visibleAncestors($id)),
                ['name' => $tree->node($id)['name'], 'url' => null],
            ],
            'children' => array_map(fn (string $c) => [
                'slug' => $this->catalog->categoryListings()[$c]->slug,
                'name' => $tree->node($c)['name'],
                'image' => $refs[$this->catalog->categoryListings()[$c]->image_media_id] ?? null,
                'product_count' => $this->productCount($c),
            ], $children),
        ];
    }

    /**
     * @return list<array{slug: string, name: string, logo: ?array<string, mixed>, product_count: int}>
     */
    public function brands(): array
    {
        $brands = $this->catalog->visibleBrands();
        $refs = $this->refs(array_map(fn (array $b) => $b['listing']->logo_media_id, $brands));
        $counts = [];
        foreach ($this->catalog->products() as $record) {
            if ($record['brand_id'] !== null) {
                $counts[$record['brand_id']] = ($counts[$record['brand_id']] ?? 0) + 1;
            }
        }

        $result = array_map(fn (array $b) => [
            'slug' => $b['slug'],
            'name' => $b['name'],
            'logo' => $refs[$b['listing']->logo_media_id] ?? null,
            'product_count' => $counts[$b['id']] ?? 0,
        ], array_values($brands));
        usort($result, fn (array $a, array $b) => strcasecmp($a['name'], $b['name']));

        return $result;
    }

    /**
     * @return array<string, mixed>
     */
    public function brand(string $slug): array
    {
        $brand = $this->brandBySlug($slug) ?? throw (new ModelNotFoundException)->setModel(BrandListing::class);
        $listing = $brand['listing'];

        return [
            'slug' => $brand['slug'],
            'name' => $brand['name'],
            'description' => $listing->description,
            'logo' => $this->refs([$listing->logo_media_id])[$listing->logo_media_id] ?? null,
            'seo' => ['title' => $listing->seo_title ?? $brand['name'], 'description' => $listing->seo_description ?? $listing->description],
        ];
    }

    /**
     * Search-as-you-type: products whose name, SKU or brand contains the term (names that
     * start with it first) and visible categories whose name contains it.
     *
     * @return array{products: list<array<string, mixed>>, categories: list<array<string, string>>}
     */
    public function suggest(string $q): array
    {
        $q = trim($q);
        if (mb_strlen($q) < 2) {
            return ['products' => [], 'categories' => []];
        }
        $needle = mb_strtolower($q);
        $rank = fn (string $name) => [str_starts_with(mb_strtolower($name), $needle) ? 0 : 1, mb_strtolower($name)];

        $records = $this->catalog->products(['q' => $q]);
        usort($records, fn (array $a, array $b) => $rank($a['name']) <=> $rank($b['name']));
        $products = array_map(function (array $record) {
            $card = $this->catalog->card($record);

            return ['slug' => $card['slug'], 'name' => $card['name'], 'url' => $card['url'], 'image' => $card['image'], 'price' => $card['price']];
        }, array_slice($records, 0, self::SUGGEST_PRODUCTS));

        $tree = $this->catalog->categoryTree();
        $categories = [];
        foreach ($this->catalog->categoryListings() as $id => $listing) {
            $name = $tree->node($id)['name'] ?? null;
            if ($name !== null && $tree->isVisible($id) && str_contains(mb_strtolower($name), $needle)) {
                $categories[] = ['slug' => $listing->slug, 'name' => $name, 'url' => '/category/'.$listing->slug];
            }
        }
        usort($categories, fn (array $a, array $b) => $rank($a['name']) <=> $rank($b['name']));

        return ['products' => $products, 'categories' => array_slice($categories, 0, self::SUGGEST_CATEGORIES)];
    }

    /**
     * Categories for a homepage strip: the given ones in order, or the visible top level.
     *
     * @param  list<string>|null  $categoryIds  null = top level
     * @return list<array<string, mixed>>
     */
    public function categoryStrip(?array $categoryIds, int $limit): array
    {
        $tree = $this->catalog->categoryTree();
        $ids = $categoryIds === null ? $tree->visibleChildren(null) : array_values(array_filter($categoryIds, fn (string $id) => $tree->isVisible($id)));
        $ids = array_slice(array_values(array_unique($ids)), 0, $limit);
        $refs = $this->refs(array_map(fn (string $id) => $this->catalog->categoryListings()[$id]->image_media_id, $ids));

        return array_map(fn (string $id) => [
            'slug' => $this->catalog->categoryListings()[$id]->slug,
            'name' => $tree->node($id)['name'],
            'url' => '/category/'.$this->catalog->categoryListings()[$id]->slug,
            'image' => $refs[$this->catalog->categoryListings()[$id]->image_media_id] ?? null,
            'product_count' => $this->productCount($id),
        ], $ids);
    }

    /**
     * Brands for a homepage strip: the given ones in order, or every visible brand by name.
     *
     * @param  list<string>|null  $brandIds  null = all
     * @return list<array<string, mixed>>
     */
    public function brandStrip(?array $brandIds, int $limit): array
    {
        $brands = $this->catalog->visibleBrands();
        if ($brandIds === null) {
            $list = array_values($brands);
            usort($list, fn (array $a, array $b) => strcasecmp($a['name'], $b['name']));
        } else {
            $list = array_values(array_filter(array_map(fn (string $id) => $brands[$id] ?? null, array_values(array_unique($brandIds)))));
        }
        $list = array_slice($list, 0, $limit);
        $refs = $this->refs(array_map(fn (array $b) => $b['listing']->logo_media_id, $list));

        return array_map(fn (array $b) => [
            'slug' => $b['slug'],
            'name' => $b['name'],
            'url' => '/brand/'.$b['slug'],
            'logo' => $refs[$b['listing']->logo_media_id] ?? null,
        ], $list);
    }

    /**
     * Visible categories among the ids, keyed by id.
     *
     * @param  list<string>  $ids
     * @return array<string, array{slug: string, name: string}>
     */
    public function visibleCategories(array $ids): array
    {
        $tree = $this->catalog->categoryTree();
        $result = [];
        foreach ($ids as $id) {
            if ($tree->isVisible($id)) {
                $result[$id] = ['slug' => $this->catalog->categoryListings()[$id]->slug, 'name' => $tree->node($id)['name']];
            }
        }

        return $result;
    }

    /**
     * Visible brands among the ids, keyed by id.
     *
     * @param  list<string>  $ids
     * @return array<string, array{slug: string, name: string}>
     */
    public function visibleBrands(array $ids): array
    {
        $brands = $this->catalog->visibleBrands();
        $result = [];
        foreach ($ids as $id) {
            if (isset($brands[$id])) {
                $result[$id] = ['slug' => $brands[$id]['slug'], 'name' => $brands[$id]['name']];
            }
        }

        return $result;
    }

    /**
     * Search metadata of a storefront page, or null when it does not exist: title (SEO title
     * or name), description (SEO description, else a plain-text excerpt of at most 160
     * characters), the first image, the name and, for categories and brands, the breadcrumb
     * trail (E12).
     *
     * @param  'category'|'brand'|'product'  $type
     * @return array{title: string, description: ?string, image_url: ?string, name: string, breadcrumbs: list<array{name: string, url: string}>}|null
     */
    public function meta(string $type, string $slug): ?array
    {
        if ($type === 'category') {
            $id = $this->categoryIdBySlug($slug);
            if ($id === null) {
                return null;
            }
            $tree = $this->catalog->categoryTree();
            $listing = $this->catalog->categoryListings()[$id];
            $refs = $this->refs([$listing->banner_media_id, $listing->image_media_id]);
            $name = $tree->node($id)['name'];

            return [
                'title' => $listing->seo_title ?? $name,
                'description' => $listing->seo_description ?? PlainText::excerpt($listing->description_html, self::META_DESCRIPTION_LENGTH),
                'image_url' => ($refs[$listing->banner_media_id] ?? $refs[$listing->image_media_id] ?? null)['url'] ?? null,
                'name' => $name,
                'breadcrumbs' => [
                    ['name' => 'Home', 'url' => '/'],
                    ...array_map(fn (string $a) => ['name' => $tree->node($a)['name'], 'url' => '/category/'.$this->catalog->categoryListings()[$a]->slug], $tree->visibleAncestors($id)),
                    ['name' => $name, 'url' => '/category/'.$listing->slug],
                ],
            ];
        }
        if ($type === 'brand') {
            $brand = $this->brandBySlug($slug);
            if ($brand === null) {
                return null;
            }
            $listing = $brand['listing'];

            return [
                'title' => $listing->seo_title ?? $brand['name'],
                'description' => $listing->seo_description ?? PlainText::excerpt($listing->description, self::META_DESCRIPTION_LENGTH),
                'image_url' => $this->refs([$listing->logo_media_id])[$listing->logo_media_id]['url'] ?? null,
                'name' => $brand['name'],
                'breadcrumbs' => [
                    ['name' => 'Home', 'url' => '/'],
                    ['name' => $brand['name'], 'url' => '/brand/'.$brand['slug']],
                ],
            ];
        }

        $record = $this->catalog->products(['slug' => $slug])[0] ?? null;
        if ($record === null) {
            return null;
        }
        $listing = $record['listing'];

        return [
            'title' => $listing->seo_title ?? $record['name'],
            'description' => $listing->seo_description
                ?? PlainText::excerpt($listing->short_description ?? $listing->description_html, self::META_DESCRIPTION_LENGTH),
            'image_url' => $record['images'][0]['url'] ?? null,
            'name' => $record['name'],
            'breadcrumbs' => [],
        ];
    }

    /**
     * Visible categories for the sitemap: slug and last change of the listing, by slug.
     *
     * @return list<array{slug: string, updated_at: ?DateTimeInterface}>
     */
    public function sitemapCategories(): array
    {
        $tree = $this->catalog->categoryTree();
        $result = [];
        foreach ($this->catalog->categoryListings() as $id => $listing) {
            if ($tree->isVisible($id)) {
                $result[] = ['slug' => $listing->slug, 'updated_at' => $listing->updated_at];
            }
        }
        usort($result, fn (array $a, array $b) => strcmp($a['slug'], $b['slug']));

        return $result;
    }

    /**
     * Visible brands for the sitemap: slug and last change of the listing, by slug.
     *
     * @return list<array{slug: string, updated_at: ?DateTimeInterface}>
     */
    public function sitemapBrands(): array
    {
        $result = array_map(fn (array $b) => ['slug' => $b['slug'], 'updated_at' => $b['listing']->updated_at], array_values($this->catalog->visibleBrands()));
        usort($result, fn (array $a, array $b) => strcmp($a['slug'], $b['slug']));

        return $result;
    }

    private function productCount(string $categoryId): int
    {
        return $this->catalog->subtreeCount($categoryId, $this->counts ??= $this->catalog->liveCountsByCategory());
    }

    private function categoryIdBySlug(string $slug): ?string
    {
        $tree = $this->catalog->categoryTree();
        foreach ($this->catalog->categoryListings() as $id => $listing) {
            if (mb_strtolower($listing->slug) === mb_strtolower($slug) && $tree->isVisible($id)) {
                return $id;
            }
        }

        return null;
    }

    /**
     * @return array{id: string, name: string, slug: string, listing: BrandListing}|null
     */
    private function brandBySlug(string $slug): ?array
    {
        foreach ($this->catalog->visibleBrands() as $brand) {
            if (mb_strtolower($brand['slug']) === mb_strtolower($slug)) {
                return $brand;
            }
        }

        return null;
    }

    /**
     * @param  array<array-key, ?string>  $ids
     * @return array<string, array<string, mixed>>
     */
    private function refs(array $ids): array
    {
        return $this->media->refs(array_values(array_unique(array_filter($ids, 'is_string'))));
    }
}
