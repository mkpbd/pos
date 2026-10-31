<?php

namespace App\Modules\OnlineCatalog\Domain;

use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * Disjunctive faceting: each facet is counted over the items that pass every active
 * filter except the facet's own, so selecting a brand never zeroes the other brands.
 * Category counts use the fully filtered set (the category is the page's scope, not a
 * filter the shopper toggles).
 */
final class FacetCalculator
{
    /**
     * @param  list<CatalogItem>  $items
     * @return list<CatalogItem>
     */
    public static function apply(array $items, CatalogFilter $filter): array
    {
        return array_values(array_filter($items, fn (CatalogItem $item) => $filter->matches($item)));
    }

    /**
     * @param  list<CatalogItem>  $items  the candidate set (scope and search already applied)
     * @param  list<string>  $attributeSlugs  facetable attributes
     * @return array{
     *   categories: array<string, int>,
     *   brands: array<string, int>,
     *   attributes: array<string, array<string, array{value: string, count: int}>>,
     *   price: array{min: ?string, max: ?string},
     *   in_stock: int,
     *   on_sale: int
     * }
     */
    public static function compute(array $items, CatalogFilter $filter, array $attributeSlugs): array
    {
        $categories = [];
        $brands = [];
        $attributes = array_fill_keys($attributeSlugs, []);
        $min = null;
        $max = null;
        $inStock = 0;
        $onSale = 0;

        foreach ($items as $item) {
            if ($filter->matches($item)) {
                if ($item->categoryId !== null) {
                    $categories[$item->categoryId] = ($categories[$item->categoryId] ?? 0) + 1;
                }
            }
            if ($item->brandId !== null && $filter->matches($item, CatalogFilter::BRAND)) {
                $brands[$item->brandId] = ($brands[$item->brandId] ?? 0) + 1;
            }
            if ($filter->matches($item, CatalogFilter::PRICE)) {
                $min = $min === null || Decimal::compare($item->price, $min) < 0 ? $item->price : $min;
                $max = $max === null || Decimal::compare($item->price, $max) > 0 ? $item->price : $max;
            }
            if ($item->inStock && $filter->matches($item, CatalogFilter::IN_STOCK)) {
                $inStock++;
            }
            if ($item->onSale && $filter->matches($item, CatalogFilter::ON_SALE)) {
                $onSale++;
            }
            foreach ($attributeSlugs as $slug) {
                if (! isset($item->attributeValues[$slug]) || ! $filter->matches($item, CatalogFilter::attributeKey($slug))) {
                    continue;
                }
                foreach ($item->attributeValues[$slug] as $key => $display) {
                    $key = (string) $key;
                    $attributes[$slug][$key] ??= ['value' => $display, 'count' => 0];
                    $attributes[$slug][$key]['count']++;
                }
            }
        }

        return [
            'categories' => $categories,
            'brands' => $brands,
            'attributes' => $attributes,
            'price' => ['min' => $min, 'max' => $max],
            'in_stock' => $inStock,
            'on_sale' => $onSale,
        ];
    }
}
