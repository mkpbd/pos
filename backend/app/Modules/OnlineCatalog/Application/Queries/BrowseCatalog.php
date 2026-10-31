<?php

namespace App\Modules\OnlineCatalog\Application\Queries;

use App\Modules\OnlineCatalog\Domain\CatalogFilter;
use App\Modules\OnlineCatalog\Domain\CatalogItem;
use App\Modules\OnlineCatalog\Domain\CatalogSort;
use App\Modules\OnlineCatalog\Domain\FacetCalculator;
use App\Modules\OnlineCatalog\Infrastructure\Models\CategoryListing;
use App\Modules\OnlineCatalog\Infrastructure\ReadModels\CatalogReadModel;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Database\Eloquent\ModelNotFoundException;

/**
 * The shop listing (shop, category, brand and search pages): live products narrowed by
 * search and category scope, filtered by brand, price, attributes, stock and sale, with
 * disjunctive facet counts, sorted and paged. Also the homepage's product sources.
 */
class BrowseCatalog
{
    public const PER_PAGE = [12, 24, 36, 48];

    public const SOURCES = ['featured', 'new_arrivals', 'best_sellers', 'on_sale', 'category'];

    public function __construct(private readonly CatalogReadModel $catalog) {}

    /**
     * @param  array{q?: ?string, category?: ?string, brand?: list<string>, price_min?: ?string, price_max?: ?string, attr?: array<string, list<string>>, in_stock?: bool, on_sale?: bool, sort?: ?string, page?: int, per_page?: int}  $params  validated
     * @return array{data: list<array<string, mixed>>, meta: array<string, int>, facets: array<string, mixed>, context: array<string, mixed>}
     */
    public function search(array $params): array
    {
        $tree = $this->catalog->categoryTree();
        $listings = $this->catalog->categoryListings();
        $q = isset($params['q']) && trim((string) $params['q']) !== '' ? trim((string) $params['q']) : null;

        $category = null;
        if (isset($params['category']) && $params['category'] !== '') {
            $category = $this->visibleCategoryBySlug($params['category'])
                ?? throw (new ModelNotFoundException)->setModel(CategoryListing::class);
        }

        $records = $this->catalog->products(array_filter([
            'q' => $q,
            'category_ids' => $category === null ? null : $tree->withDescendants($category),
        ], fn ($v) => $v !== null));

        $visibleBrands = $this->catalog->visibleBrands();
        $brandIdsBySlug = [];
        foreach ($visibleBrands as $id => $brand) {
            $brandIdsBySlug[mb_strtolower($brand['slug'])] = $id;
        }
        $brandIds = array_values(array_unique(array_filter(array_map(
            fn (string $slug) => $brandIdsBySlug[mb_strtolower($slug)] ?? null,
            $params['brand'] ?? [],
        ))));

        $facetable = array_values(array_filter($this->catalog->attributes(), fn (array $a) => $a['is_filterable']));
        $facetableSlugs = array_column($facetable, 'slug');
        $attrFilter = [];
        foreach ($params['attr'] ?? [] as $slug => $values) {
            $slug = mb_strtolower((string) $slug);
            if (in_array($slug, $facetableSlugs, true)) {
                $attrFilter[$slug] = array_values(array_filter((array) $values, 'is_string'));
            }
        }

        $filter = new CatalogFilter(
            brandIds: $brandIds,
            priceMin: $params['price_min'] ?? null,
            priceMax: $params['price_max'] ?? null,
            attributes: $attrFilter,
            inStock: (bool) ($params['in_stock'] ?? false),
            onSale: (bool) ($params['on_sale'] ?? false),
        );

        $byId = [];
        $items = [];
        foreach ($records as $record) {
            $byId[$record['id']] = $record;
            $items[] = $this->catalog->item($record);
        }

        $sort = CatalogSort::tryFrom((string) ($params['sort'] ?? '')) ?? CatalogSort::Featured;
        $matching = $sort->sort(FacetCalculator::apply($items, $filter));
        $counts = FacetCalculator::compute($items, $filter, $facetableSlugs);

        $perPage = (int) ($params['per_page'] ?? 24);
        $page = max(1, (int) ($params['page'] ?? 1));
        $total = count($matching);

        return [
            'data' => array_map(fn (CatalogItem $item) => $this->catalog->card($byId[$item->id]), array_slice($matching, ($page - 1) * $perPage, $perPage)),
            'meta' => [
                'current_page' => $page,
                'per_page' => $perPage,
                'total' => $total,
                'last_page' => max(1, (int) ceil($total / $perPage)),
            ],
            'facets' => [
                'categories' => $this->categoryFacet($category, $counts['categories']),
                'brands' => $this->brandFacet($visibleBrands, $brandIds, $counts['brands']),
                'attributes' => $this->attributeFacets($facetable, $filter, $counts['attributes']),
                'price' => $counts['price'],
                'in_stock' => ['count' => $counts['in_stock']],
                'on_sale' => ['count' => $counts['on_sale']],
            ],
            'context' => [
                'category' => $category === null ? null : ['slug' => $listings[$category]->slug, 'name' => $tree->node($category)['name']],
                'brand' => count($brandIds) === 1 ? ['slug' => $visibleBrands[$brandIds[0]]['slug'], 'name' => $visibleBrands[$brandIds[0]]['name']] : null,
                'q' => $q,
            ],
        ];
    }

    /**
     * Exactly the given live products, in the given order (recently viewed lists).
     *
     * @param  list<string>  $slugs
     * @return array{data: list<array<string, mixed>>, meta: array<string, int>, facets: null, context: null}
     */
    public function bySlugs(array $slugs): array
    {
        $records = [];
        foreach ($this->catalog->products(['slugs' => $slugs]) as $record) {
            $records[mb_strtolower($record['listing']->slug)] = $record;
        }

        $cards = [];
        foreach (array_unique(array_map(mb_strtolower(...), $slugs)) as $slug) {
            if (isset($records[$slug])) {
                $cards[] = $this->catalog->card($records[$slug]);
            }
        }

        return [
            'data' => $cards,
            'meta' => ['current_page' => 1, 'per_page' => max(1, count($cards)), 'total' => count($cards), 'last_page' => 1],
            'facets' => null,
            'context' => null,
        ];
    }

    /**
     * Cards of live products in the given order; unknown or hidden products drop out.
     *
     * @param  list<string>  $productIds
     * @return list<array<string, mixed>>
     */
    public function cards(array $productIds): array
    {
        if ($productIds === []) {
            return [];
        }
        $records = array_column($this->catalog->products(['ids' => $productIds]), null, 'id');

        $cards = [];
        foreach (array_unique($productIds) as $id) {
            if (isset($records[$id])) {
                $cards[] = $this->catalog->card($records[$id]);
            }
        }

        return $cards;
    }

    /**
     * Products for a homepage source. Stock never hides a product (cards show it).
     *
     * @return list<array<string, mixed>>
     */
    public function sourceCards(string $source, ?string $categoryId, int $limit): array
    {
        $options = [];
        if ($source === 'category') {
            if ($categoryId === null || ! $this->catalog->categoryTree()->has($categoryId)) {
                return [];
            }
            $options['category_ids'] = $this->catalog->categoryTree()->withDescendants($categoryId);
        }

        $byId = [];
        $items = [];
        foreach ($this->catalog->products($options) as $record) {
            $byId[$record['id']] = $record;
            $items[] = $this->catalog->item($record);
        }

        [$items, $sort] = match ($source) {
            'featured' => [array_filter($items, fn (CatalogItem $i) => $i->isFeatured), CatalogSort::Featured],
            'new_arrivals' => [$items, CatalogSort::Latest],
            'best_sellers' => [array_filter($items, fn (CatalogItem $i) => Decimal::compare($i->unitsSold30d, '0') > 0), CatalogSort::Popularity],
            'on_sale' => [array_filter($items, fn (CatalogItem $i) => $i->onSale), CatalogSort::Featured],
            default => [$items, CatalogSort::Featured],
        };

        return array_map(
            fn (CatalogItem $item) => $this->catalog->card($byId[$item->id]),
            array_slice($sort->sort(array_values($items)), 0, $limit),
        );
    }

    /**
     * Hot deals (E8b): live products targeted by live countdown promotions (or just
     * $promotionId), whose card shows such a promotion — in featured order.
     *
     * @return list<array<string, mixed>>
     */
    public function hotDealCards(?string $promotionId, int $limit): array
    {
        $deals = $this->catalog->countdownPromotions($promotionId);
        if ($deals === []) {
            return [];
        }
        $productIds = array_fill_keys(array_merge(...array_column($deals, 'product_ids')), true);
        $categoryIds = array_fill_keys(array_merge(...array_column($deals, 'category_ids')), true);
        $brandIds = array_fill_keys(array_merge(...array_column($deals, 'brand_ids')), true);
        $countdownIds = array_fill_keys(array_column($deals, 'id'), true);

        $byId = [];
        $items = [];
        foreach ($this->catalog->products() as $record) {
            if (isset($productIds[$record['id']])
                || ($record['category_id'] !== null && isset($categoryIds[$record['category_id']]))
                || ($record['brand_id'] !== null && isset($brandIds[$record['brand_id']]))) {
                $byId[$record['id']] = $record;
                $items[] = $this->catalog->item($record);
            }
        }

        $cards = [];
        foreach (CatalogSort::Featured->sort($items) as $item) {
            $card = $this->catalog->card($byId[$item->id]);
            if (($card['promotion']['show_countdown'] ?? false) && isset($countdownIds[$card['promotion']['id']])) {
                $cards[] = $card;
                if (count($cards) >= $limit) {
                    break;
                }
            }
        }

        return $cards;
    }

    private function visibleCategoryBySlug(string $slug): ?string
    {
        $tree = $this->catalog->categoryTree();
        foreach ($this->catalog->categoryListings() as $categoryId => $listing) {
            if (mb_strtolower($listing->slug) === mb_strtolower($slug) && $tree->isVisible($categoryId)) {
                return $categoryId;
            }
        }

        return null;
    }

    /**
     * Visible children of the current category (or the roots) with subtree counts.
     *
     * @param  array<string, int>  $counts  matching products per category
     * @return list<array{slug: string, name: string, count: int}>
     */
    private function categoryFacet(?string $category, array $counts): array
    {
        $tree = $this->catalog->categoryTree();
        $result = [];
        foreach ($tree->visibleChildren($category) as $id) {
            $count = 0;
            foreach ($tree->withDescendants($id) as $descendant) {
                $count += $counts[$descendant] ?? 0;
            }
            if ($count > 0) {
                $result[] = ['slug' => $this->catalog->categoryListings()[$id]->slug, 'name' => $tree->node($id)['name'], 'count' => $count];
            }
        }

        return $result;
    }

    /**
     * @param  array<string, array{id: string, name: string, slug: string}>  $visibleBrands
     * @param  list<string>  $selected
     * @param  array<string, int>  $counts
     * @return list<array{slug: string, name: string, count: int, selected: bool}>
     */
    private function brandFacet(array $visibleBrands, array $selected, array $counts): array
    {
        $result = [];
        foreach ($visibleBrands as $id => $brand) {
            $count = $counts[$id] ?? 0;
            $isSelected = in_array($id, $selected, true);
            if ($count > 0 || $isSelected) {
                $result[] = ['slug' => $brand['slug'], 'name' => $brand['name'], 'count' => $count, 'selected' => $isSelected];
            }
        }
        usort($result, fn (array $a, array $b) => strcasecmp($a['name'], $b['name']));

        return $result;
    }

    /**
     * Facetable attributes with their values in dictionary order (values the dictionary
     * does not know follow alphabetically).
     *
     * @param  list<array<string, mixed>>  $attributes
     * @param  array<string, array<string, array{value: string, count: int}>>  $counts
     * @return list<array<string, mixed>>
     */
    private function attributeFacets(array $attributes, CatalogFilter $filter, array $counts): array
    {
        $result = [];
        foreach ($attributes as $attribute) {
            $slug = $attribute['slug'];
            $found = $counts[$slug] ?? [];
            $selected = $filter->attributes[$slug] ?? [];
            $values = [];

            foreach ($attribute['values'] as $known) {
                $key = mb_strtolower($known['value']);
                $count = $found[$key]['count'] ?? 0;
                $isSelected = in_array($key, $selected, true);
                if ($count > 0 || $isSelected) {
                    $values[] = ['value' => $known['value'], 'swatch_hex' => $known['swatch_hex'], 'count' => $count, 'selected' => $isSelected];
                }
                unset($found[$key]);
                $selected = array_values(array_diff($selected, [$key]));
            }

            $extra = [];
            foreach ($found as $key => $entry) {
                $key = (string) $key;
                $extra[] = ['value' => $entry['value'], 'swatch_hex' => null, 'count' => $entry['count'], 'selected' => in_array($key, $selected, true)];
                $selected = array_values(array_diff($selected, [$key]));
            }
            foreach ($selected as $missing) {
                $extra[] = ['value' => $missing, 'swatch_hex' => null, 'count' => 0, 'selected' => true];
            }
            usort($extra, fn (array $a, array $b) => strnatcasecmp($a['value'], $b['value']));
            $values = [...$values, ...$extra];

            if ($values !== []) {
                $result[] = ['slug' => $slug, 'name' => $attribute['name'], 'display' => $attribute['display'], 'values' => $values];
            }
        }

        return $result;
    }
}
