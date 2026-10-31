<?php

namespace App\Modules\OnlineCatalog\Tests\Unit;

use App\Modules\OnlineCatalog\Domain\CatalogFilter;
use App\Modules\OnlineCatalog\Domain\CatalogItem;
use App\Modules\OnlineCatalog\Domain\CatalogSort;
use App\Modules\OnlineCatalog\Domain\CategoryTree;
use App\Modules\OnlineCatalog\Domain\FacetCalculator;
use App\Modules\OnlineCatalog\Domain\ListingState;
use App\Modules\OnlineCatalog\Domain\Pricing;
use App\Modules\Shared\Domain\Slug;
use Carbon\CarbonImmutable;
use PHPUnit\Framework\TestCase;

class CatalogDomainTest extends TestCase
{
    /**
     * @param  array<string, array<string, string>>  $attributes
     */
    private function item(string $id, ?string $brand, string $price, bool $inStock = true, bool $onSale = false, array $attributes = [], ?string $category = null, string $published = '2026-10-01 00:00:00.000000', string $sold = '0'): CatalogItem
    {
        return new CatalogItem($id, ucfirst($id), $brand, $category, $price, $onSale, $inStock, false, 0, $published, $sold, $sold, $attributes);
    }

    /**
     * @return list<CatalogItem>
     */
    private function items(): array
    {
        return [
            $this->item('a', 'pran', '10.00', true, true, ['size' => ['s' => 'S', 'm' => 'M']], 'drinks'),
            $this->item('b', 'pran', '25.00', false, false, ['size' => ['m' => 'M']], 'drinks'),
            $this->item('c', 'acme', '40.00', true, false, ['size' => ['l' => 'L']], 'snacks'),
            $this->item('d', null, '5.50', true, true, [], 'snacks'),
        ];
    }

    public function test_facets_ignore_their_own_filter(): void
    {
        $filter = new CatalogFilter(brandIds: ['pran'], attributes: ['size' => ['M']], inStock: true);
        $facets = FacetCalculator::compute($this->items(), $filter, ['size']);

        $this->assertSame(['a'], array_map(fn (CatalogItem $i) => $i->id, FacetCalculator::apply($this->items(), $filter)));
        // Brands: size M and in stock → only "a" (pran); acme's "c" has no M.
        $this->assertSame(['pran' => 1], $facets['brands']);
        // Size: brand pran and in stock → "a" (S, M).
        $this->assertSame(['s' => ['value' => 'S', 'count' => 1], 'm' => ['value' => 'M', 'count' => 1]], $facets['attributes']['size']);
        // In stock: brand pran and size M → a (in stock), b (not) → 1.
        $this->assertSame(1, $facets['in_stock']);
        $this->assertSame(['drinks' => 1], $facets['categories']);
        $this->assertSame(['min' => '10.00', 'max' => '10.00'], $facets['price']);
    }

    public function test_values_within_a_facet_are_ored_and_facets_are_anded(): void
    {
        $filter = new CatalogFilter(attributes: ['size' => ['s', 'L']], priceMin: '6', priceMax: '40');
        $this->assertSame(['a', 'c'], array_map(fn (CatalogItem $i) => $i->id, FacetCalculator::apply($this->items(), $filter)));

        $facets = FacetCalculator::compute($this->items(), $filter, ['size']);
        $this->assertSame(['min' => '10.00', 'max' => '40.00'], $facets['price'], 'Items without a matching size are outside the price facet too.');
        $this->assertSame(1, $facets['on_sale']);
        $this->assertSame(['pran' => 1, 'acme' => 1], $facets['brands']);
    }

    public function test_an_empty_set_has_no_price_range(): void
    {
        $facets = FacetCalculator::compute([], new CatalogFilter, []);
        $this->assertSame(['min' => null, 'max' => null], $facets['price']);
        $this->assertSame(0, $facets['in_stock']);
    }

    public function test_sorting_is_exact_and_stable(): void
    {
        $items = [
            $this->item('b', null, '100.10', published: '2026-10-02 00:00:00.000000', sold: '2'),
            $this->item('a', null, '100.09', published: '2026-10-03 00:00:00.000000', sold: '2.5'),
            $this->item('c', null, '9.99', published: '2026-10-01 00:00:00.000000'),
        ];
        $ids = fn (CatalogSort $s) => array_map(fn (CatalogItem $i) => $i->id, $s->sort($items));

        $this->assertSame(['c', 'a', 'b'], $ids(CatalogSort::PriceAsc));
        $this->assertSame(['b', 'a', 'c'], $ids(CatalogSort::PriceDesc));
        $this->assertSame(['a', 'b', 'c'], $ids(CatalogSort::Latest));
        $this->assertSame(['a', 'b', 'c'], $ids(CatalogSort::Popularity));
        $this->assertSame(['a', 'b', 'c'], $ids(CatalogSort::Name));
    }

    public function test_pricing(): void
    {
        $this->assertSame('140.00', Pricing::effectiveCompareAt('120.00', '140'));
        $this->assertNull(Pricing::effectiveCompareAt('120.00', '120.00'));
        $this->assertSame(14, Pricing::discountPercent('120.00', '140.00'));
        $this->assertSame(33, Pricing::discountPercent('0.67', '1.00'));
        $this->assertNull(Pricing::discountPercent('150.00', '140.00'));

        $summary = Pricing::summary([
            ['price' => '150.00', 'compare_at_price' => '200.00'],
            ['price' => '120.00', 'compare_at_price' => null],
            ['price' => '120.00', 'compare_at_price' => '130.00'],
        ]);
        $this->assertSame(['price' => '120.00', 'price_max' => '150.00', 'compare_at_price' => '130.00', 'on_sale' => true, 'discount_percent' => 7], $summary);

        $plain = Pricing::summary([['price' => '99.00', 'compare_at_price' => null], ['price' => '80.00', 'compare_at_price' => null]]);
        $this->assertSame(['80.00', '99.00', null, false, null], array_values($plain));
    }

    public function test_category_tree_reattaches_children_of_hidden_categories(): void
    {
        $c = fn (string $id, ?string $parent) => ['id' => $id, 'parent_id' => $parent, 'name' => strtoupper($id), 'sort_order' => 0, 'is_active' => true];
        $tree = new CategoryTree([$c('root', null), $c('hidden', 'root'), $c('leaf', 'hidden'), $c('other', null), $c('deep', 'leaf')], ['root', 'leaf', 'other']);

        $this->assertSame(['root', 'other'], $tree->visibleChildren(null));
        $this->assertSame(['leaf'], $tree->visibleChildren('root'));
        $this->assertSame(['root', 'leaf'], $tree->visibleAncestors('deep'));
        $this->assertSame(['hidden', 'leaf', 'deep'], $tree->withDescendants('hidden'));
        $this->assertSame([0, 1, 2, 3, 0], array_column($tree->flatten(), 'depth'));

        $hiddenRoot = new CategoryTree([$c('root', null), $c('child', 'root')], ['child']);
        $this->assertSame(['child'], $hiddenRoot->visibleChildren(null));
    }

    public function test_listing_state(): void
    {
        $now = CarbonImmutable::parse('2026-10-31 12:00:00');
        $this->assertSame(ListingState::Draft, ListingState::of(false, null, null, $now));
        $this->assertSame(ListingState::Live, ListingState::of(true, null, null, $now));
        $this->assertSame(ListingState::Scheduled, ListingState::of(true, $now->addMinute(), null, $now));
        $this->assertSame(ListingState::Live, ListingState::of(true, $now, $now->addDay(), $now));
        $this->assertSame(ListingState::Expired, ListingState::of(true, null, $now, $now));
    }

    public function test_slugs(): void
    {
        $this->assertTrue(Slug::isValid('mango-juice-1l'));
        $this->assertFalse(Slug::isValid('Mango'));
        $this->assertFalse(Slug::isValid('mango--juice'));
        $this->assertFalse(Slug::isValid('-mango'));
        $this->assertFalse(Slug::isValid(str_repeat('a', 121)));

        $taken = ['mango-juice', 'mango-juice-2'];
        $this->assertSame('mango-juice-3', Slug::suggest('Mango Juice!', fn (string $s) => in_array($s, $taken, true)));
        $this->assertSame('item', Slug::suggest('!!!', fn () => false));
        $base = Slug::fromName(str_repeat('word ', 40));
        $long = Slug::suggest(str_repeat('word ', 40), fn (string $s) => $s === $base);
        $this->assertLessThanOrEqual(120, strlen($long));
        $this->assertStringEndsWith('-2', $long);
    }
}
