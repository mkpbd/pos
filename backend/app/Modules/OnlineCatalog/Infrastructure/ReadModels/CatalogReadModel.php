<?php

namespace App\Modules\OnlineCatalog\Infrastructure\ReadModels;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\Inventory\Application\Contracts\StockLevels;
use App\Modules\OnlineCatalog\Domain\CatalogItem;
use App\Modules\OnlineCatalog\Domain\CategoryTree;
use App\Modules\OnlineCatalog\Domain\ListingState;
use App\Modules\OnlineCatalog\Domain\Pricing;
use App\Modules\OnlineCatalog\Infrastructure\Models\BrandListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\CategoryListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\ProductListing;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\DB;

/**
 * The storefront's read side of the catalog. It loads the candidate products (live listings
 * of active, non-archived products of the current organization, optionally narrowed by
 * search, category scope, ids or slug) with their active variants, images, stock and
 * popularity in a handful of queries; filtering, faceting, sorting and paging then happen
 * in PHP, identically on PostgreSQL and SQLite.
 *
 * Scale assumption: a few thousand published products per organization (E12 revisits this
 * with EXPLAIN on real data). Reads the Products, Catalog, Inventory and Storefront tables
 * read-only, like the Inventory stock list does; every query is filtered by organization.
 *
 * Instances cache reference data (categories, brands, attributes, fulfilment store) for
 * their lifetime, so resolve a fresh instance per request.
 *
 * @phpstan-type VariantRecord array{id: string, sku: string, name: ?string, option_values: array<string, string>, price: string, compare_at_price: ?string, raw_compare_at_price: ?string, image_id: ?string, is_active: bool, tracked: bool, in_stock: bool, low_stock: bool}
 * @phpstan-type ProductRecord array{id: string, name: string, category_id: ?string, brand_id: ?string, unit_id: ?string, options: list<array{name: string, values: list<string>}>, is_active: bool, listing: ProductListing, variants: list<VariantRecord>, images: list<array{id: string, url: string}>, units_sold_30d: string, units_sold_total: string}
 */
class CatalogReadModel
{
    private const CHUNK = 500;

    /** Quantities at or below this (but above zero) show as "only a few left". */
    public const LOW_STOCK_THRESHOLD = '5';

    private ?CategoryTree $tree = null;

    /** @var array<string, CategoryListing>|null */
    private ?array $categoryListings = null;

    /** @var array<string, BrandListing>|null */
    private ?array $brandListings = null;

    /** @var array<string, array{id: string, name: string, is_active: bool}>|null */
    private ?array $brands = null;

    /** @var list<array<string, mixed>>|null */
    private ?array $attributes = null;

    private string|false|null $fulfilmentStoreId = false;

    private ?string $timezone = null;

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly CatalogDirectory $catalog,
        private readonly StockLevels $stock,
        private readonly OrganizationDirectory $organizations,
    ) {}

    public function organizationId(): string
    {
        return $this->tenant->requireOrganization();
    }

    /**
     * Products with their listing, active variants, images, stock and popularity.
     *
     * `live` (default true) keeps live listings of active products only.
     *
     * @param  array{ids?: list<string>, slug?: string, slugs?: list<string>, q?: ?string, category_ids?: list<string>, live?: bool, include_inactive_variants?: bool}  $options
     * @return list<ProductRecord>
     */
    public function products(array $options = []): array
    {
        $org = $this->organizationId();
        $live = $options['live'] ?? true;

        $query = ProductListing::query()->withoutGlobalScope('organization')
            ->join('products as p', 'p.id', '=', 'product_listings.product_id')
            ->where('product_listings.organization_id', $org)
            ->where('p.organization_id', $org)
            ->whereNull('p.deleted_at')
            ->select('product_listings.*', 'p.name as p_name', 'p.category_id as p_category_id', 'p.brand_id as p_brand_id',
                'p.unit_id as p_unit_id', 'p.type as p_type', 'p.track_stock as p_track_stock', 'p.options as p_options', 'p.is_active as p_is_active');

        if ($live) {
            $now = now();
            $query->where('p.is_active', true)
                ->where('product_listings.is_published', true)
                ->where(fn (Builder $q) => $q->whereNull('product_listings.published_at')->orWhere('product_listings.published_at', '<=', $now))
                ->where(fn (Builder $q) => $q->whereNull('product_listings.unpublished_at')->orWhere('product_listings.unpublished_at', '>', $now));
        }
        if (isset($options['slug'])) {
            $query->whereRaw('lower(product_listings.slug) = ?', [mb_strtolower($options['slug'])]);
        }
        if (isset($options['slugs'])) {
            $query->whereIn(DB::raw('lower(product_listings.slug)'), array_map(mb_strtolower(...), $options['slugs']) ?: ['']);
        }
        if (isset($options['category_ids'])) {
            $query->whereIn('p.category_id', $options['category_ids'] === [] ? [''] : $options['category_ids']);
        }
        if (isset($options['q']) && trim($options['q']) !== '') {
            $this->applySearch($query, $options['q']);
        }

        if (isset($options['ids'])) {
            $listings = collect();
            foreach (array_chunk(array_values(array_unique($options['ids'])), self::CHUNK) as $chunk) {
                $listings = $listings->concat((clone $query)->whereIn('p.id', $chunk)->get());
            }
        } else {
            $listings = $query->get();
        }

        if ($listings->isEmpty()) {
            return [];
        }

        $productIds = $listings->pluck('product_id')->all();
        $variants = $this->variants($productIds, ! ($options['include_inactive_variants'] ?? false));
        $images = $this->images($productIds);
        $stats = $this->stats($productIds);

        $tracked = [];
        foreach ($listings as $listing) {
            if ((bool) $listing->getAttribute('p_track_stock') && $listing->getAttribute('p_type') !== 'service') {
                $tracked[$listing->product_id] = true;
            }
        }
        $trackedVariantIds = [];
        foreach ($variants as $productId => $rows) {
            if (isset($tracked[$productId])) {
                array_push($trackedVariantIds, ...array_column($rows, 'id'));
            }
        }
        $quantities = $this->onHand($trackedVariantIds);

        $records = [];
        foreach ($listings as $listing) {
            $productVariants = [];
            foreach ($variants[$listing->product_id] ?? [] as $row) {
                $isTracked = isset($tracked[$listing->product_id]);
                $qty = $quantities[$row['id']] ?? '0';
                $row['tracked'] = $isTracked;
                $row['in_stock'] = ! $isTracked || Decimal::compare($qty, '0') > 0;
                $row['low_stock'] = $isTracked && Decimal::compare($qty, '0') > 0 && Decimal::compare($qty, self::LOW_STOCK_THRESHOLD) <= 0;
                $productVariants[] = $row;
            }
            if ($live && $productVariants === []) {
                // Nothing to sell: not shown.
                continue;
            }

            $options = $listing->getAttribute('p_options');
            $records[] = [
                'id' => $listing->product_id,
                'name' => (string) $listing->getAttribute('p_name'),
                'category_id' => $listing->getAttribute('p_category_id'),
                'brand_id' => $listing->getAttribute('p_brand_id'),
                'unit_id' => $listing->getAttribute('p_unit_id'),
                'options' => is_string($options) ? (json_decode($options, true) ?: []) : ($options ?? []),
                'is_active' => (bool) $listing->getAttribute('p_is_active'),
                'listing' => $listing,
                'variants' => $productVariants,
                'images' => $images[$listing->product_id] ?? [],
                'units_sold_30d' => $stats[$listing->product_id]['30d'] ?? '0.000',
                'units_sold_total' => $stats[$listing->product_id]['total'] ?? '0.000',
            ];
        }

        return $records;
    }

    /**
     * The product card every listing, carousel and related list shows.
     *
     * @param  ProductRecord  $record
     * @return array<string, mixed>
     */
    public function card(array $record): array
    {
        /** @var ProductListing $listing */
        $listing = $record['listing'];
        $variants = $this->activeVariants($record);
        $pricing = Pricing::summary($variants === [] ? [['price' => '0.00', 'compare_at_price' => null]] : $variants);
        $image = $record['images'][0] ?? null;
        $hover = $record['images'][1] ?? null;

        return [
            'id' => $record['id'],
            'slug' => $listing->slug,
            'name' => $record['name'],
            'url' => '/product/'.$listing->slug,
            'image' => $image === null ? null : ['url' => $image['url'], 'alt' => $record['name']],
            'hover_image' => $hover === null ? null : ['url' => $hover['url'], 'alt' => $record['name']],
            'price' => $pricing['price'],
            'price_max' => $pricing['price_max'],
            'compare_at_price' => $pricing['compare_at_price'],
            'on_sale' => $pricing['on_sale'],
            'discount_percent' => $pricing['discount_percent'],
            'in_stock' => $this->inStock($record),
            'is_new' => $this->isNew($listing),
            'is_featured' => $listing->is_featured,
            'brand' => $this->brandLink($record['brand_id']),
            'category' => $this->categoryLink($record['category_id']),
            'variant_count' => count($variants),
            'short_description' => $listing->short_description,
        ];
    }

    /**
     * @param  ProductRecord  $record
     */
    public function item(array $record): CatalogItem
    {
        /** @var ProductListing $listing */
        $listing = $record['listing'];
        $variants = $this->activeVariants($record);
        $pricing = Pricing::summary($variants === [] ? [['price' => '0.00', 'compare_at_price' => null]] : $variants);

        return new CatalogItem(
            id: $record['id'],
            name: $record['name'],
            brandId: $record['brand_id'],
            categoryId: $record['category_id'],
            price: $pricing['price'],
            onSale: $pricing['on_sale'],
            inStock: $this->inStock($record),
            isFeatured: $listing->is_featured,
            sortWeight: $listing->sort_weight,
            publishedAt: $this->publishedSortKey($listing),
            unitsSold30d: $record['units_sold_30d'],
            unitsSoldTotal: $record['units_sold_total'],
            attributeValues: $this->attributeValues($record),
        );
    }

    /**
     * @param  ProductRecord  $record
     */
    public function inStock(array $record): bool
    {
        foreach ($this->activeVariants($record) as $variant) {
            if ($variant['in_stock']) {
                return true;
            }
        }

        return false;
    }

    public function isNew(ProductListing $listing): bool
    {
        return $listing->is_new_until !== null
            && $listing->is_new_until->toDateString() >= CarbonImmutable::now($this->timezone())->toDateString();
    }

    /**
     * Instant the product went live, as a sortable UTC string (schedule start, else when it was listed).
     */
    public function publishedSortKey(ProductListing $listing): string
    {
        $at = $listing->published_at ?? $listing->created_at ?? CarbonImmutable::now();

        return $at->utc()->format('Y-m-d H:i:s.u');
    }

    /**
     * @param  ProductRecord  $record
     * @return list<VariantRecord>
     */
    public function activeVariants(array $record): array
    {
        return array_values(array_filter($record['variants'], fn (array $v) => $v['is_active']));
    }

    /**
     * Option values of the product's active variants for every filterable attribute the
     * product's options are linked to (by name, case-insensitively).
     *
     * @param  ProductRecord  $record
     * @return array<string, array<string, string>>
     */
    public function attributeValues(array $record): array
    {
        $byName = [];
        foreach ($this->attributes() as $attribute) {
            if ($attribute['is_filterable']) {
                $byName[mb_strtolower($attribute['name'])] = $attribute;
            }
        }
        if ($byName === []) {
            return [];
        }

        $result = [];
        foreach ($this->activeVariants($record) as $variant) {
            foreach ($variant['option_values'] as $name => $value) {
                $attribute = $byName[mb_strtolower((string) $name)] ?? null;
                if ($attribute === null || ! is_string($value) || $value === '') {
                    continue;
                }
                $key = mb_strtolower($value);
                $result[$attribute['slug']][$key] ??= $this->dictionaryValue($attribute, $value);
            }
        }

        return $result;
    }

    /**
     * The dictionary's spelling of a value when it has one.
     *
     * @param  array<string, mixed>  $attribute
     */
    public function dictionaryValue(array $attribute, string $value): string
    {
        foreach ($attribute['values'] as $known) {
            if (mb_strtolower($known['value']) === mb_strtolower($value)) {
                return $known['value'];
            }
        }

        return $value;
    }

    /**
     * Live products per category id (direct membership).
     *
     * @return array<string, int>
     */
    public function liveCountsByCategory(): array
    {
        $counts = [];
        foreach ($this->products() as $record) {
            if ($record['category_id'] !== null) {
                $counts[$record['category_id']] = ($counts[$record['category_id']] ?? 0) + 1;
            }
        }

        return $counts;
    }

    /**
     * @param  array<string, int>  $directCounts
     */
    public function subtreeCount(string $categoryId, array $directCounts): int
    {
        $total = 0;
        foreach ($this->categoryTree()->withDescendants($categoryId) as $id) {
            $total += $directCounts[$id] ?? 0;
        }

        return $total;
    }

    /**
     * The organization's category tree; categories with a visible listing and an active
     * record are the visible ones.
     */
    public function categoryTree(): CategoryTree
    {
        if ($this->tree === null) {
            $categories = $this->catalog->categories($this->organizationId());
            $active = array_column(array_filter($categories, fn (array $c) => $c['is_active']), 'id', 'id');
            $visible = [];
            foreach ($this->categoryListings() as $categoryId => $listing) {
                if ($listing->is_visible && isset($active[$categoryId])) {
                    $visible[] = $categoryId;
                }
            }
            $this->tree = new CategoryTree($categories, $visible);
        }

        return $this->tree;
    }

    /**
     * Every category listing of the organization keyed by category id.
     *
     * @return array<string, CategoryListing>
     */
    public function categoryListings(): array
    {
        return $this->categoryListings ??= CategoryListing::query()->withoutGlobalScope('organization')
            ->where('organization_id', $this->organizationId())->get()->keyBy('category_id')->all();
    }

    /**
     * Every brand listing of the organization keyed by brand id.
     *
     * @return array<string, BrandListing>
     */
    public function brandListings(): array
    {
        return $this->brandListings ??= BrandListing::query()->withoutGlobalScope('organization')
            ->where('organization_id', $this->organizationId())->get()->keyBy('brand_id')->all();
    }

    /**
     * @return array<string, array{id: string, name: string, is_active: bool}>
     */
    public function brands(): array
    {
        return $this->brands ??= array_column($this->catalog->brands($this->organizationId()), null, 'id');
    }

    /**
     * Brands shown on the storefront (visible listing, active brand) keyed by id.
     *
     * @return array<string, array{id: string, name: string, slug: string, listing: BrandListing}>
     */
    public function visibleBrands(): array
    {
        $result = [];
        foreach ($this->brands() as $id => $brand) {
            $listing = $this->brandListings()[$id] ?? null;
            if ($listing !== null && $listing->is_visible && $brand['is_active']) {
                $result[$id] = ['id' => $id, 'name' => $brand['name'], 'slug' => $listing->slug, 'listing' => $listing];
            }
        }

        return $result;
    }

    /**
     * @return list<array{id: string, name: string, slug: string, display: string, is_filterable: bool, sort_order: int, values: list<array{value: string, swatch_hex: ?string}>}>
     */
    public function attributes(): array
    {
        return $this->attributes ??= $this->catalog->attributes($this->organizationId());
    }

    /**
     * @return array{name: string, slug: ?string}|null
     */
    public function brandLink(?string $brandId): ?array
    {
        if ($brandId === null || ! isset($this->brands()[$brandId])) {
            return null;
        }

        return ['name' => $this->brands()[$brandId]['name'], 'slug' => $this->visibleBrands()[$brandId]['slug'] ?? null];
    }

    /**
     * @return array{name: string, slug: ?string}|null
     */
    public function categoryLink(?string $categoryId): ?array
    {
        $node = $categoryId === null ? null : $this->categoryTree()->node($categoryId);
        if ($node === null) {
            return null;
        }

        return ['name' => $node['name'], 'slug' => $this->categoryTree()->isVisible($categoryId) ? $this->categoryListings()[$categoryId]->slug : null];
    }

    public function fulfilmentStoreId(): ?string
    {
        if ($this->fulfilmentStoreId === false) {
            $this->fulfilmentStoreId = DB::table('storefront_settings')
                ->where('organization_id', $this->organizationId())->value('fulfilment_store_id');
        }

        return $this->fulfilmentStoreId;
    }

    public function timezone(): string
    {
        return $this->timezone ??= ($this->organizations->summary($this->organizationId())['timezone'] ?? (string) config('app.timezone'));
    }

    /**
     * State of a listing (draft/scheduled/live/expired) for previews and the admin.
     */
    public function state(ProductListing $listing): ListingState
    {
        return $listing->state();
    }

    /**
     * Case-insensitive substring match on product name, any live SKU or the brand name.
     *
     * @param  Builder<ProductListing>  $query
     */
    private function applySearch(Builder $query, string $q): void
    {
        $like = '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], mb_strtolower(trim($q))).'%';

        $query->where(fn (Builder $w) => $w
            ->whereRaw("lower(p.name) like ? escape '!'", [$like])
            ->orWhereExists(fn (QueryBuilder $s) => $s->from('product_variants as sv')
                ->whereColumn('sv.product_id', 'p.id')->whereNull('sv.deleted_at')->where('sv.is_active', true)
                ->whereRaw("lower(sv.sku) like ? escape '!'", [$like]))
            ->orWhereExists(fn (QueryBuilder $s) => $s->from('brands as sb')
                ->whereColumn('sb.id', 'p.brand_id')
                ->whereRaw("lower(sb.name) like ? escape '!'", [$like])));
    }

    /**
     * @param  list<string>  $productIds
     * @return array<string, list<array<string, mixed>>>
     */
    private function variants(array $productIds, bool $activeOnly): array
    {
        $result = [];
        foreach (array_chunk($productIds, self::CHUNK) as $chunk) {
            $rows = DB::table('product_variants as pv')
                ->leftJoin('variant_listings as vl', 'vl.variant_id', '=', 'pv.id')
                ->where('pv.organization_id', $this->organizationId())
                ->whereIn('pv.product_id', $chunk)
                ->whereNull('pv.deleted_at')
                ->when($activeOnly, fn (QueryBuilder $q) => $q->where('pv.is_active', true))
                ->orderBy('pv.sort_order')->orderBy('pv.id')
                ->get(['pv.id', 'pv.product_id', 'pv.sku', 'pv.name', 'pv.option_values', 'pv.selling_price', 'pv.is_active', 'vl.compare_at_price', 'vl.image_id']);

            foreach ($rows as $row) {
                $price = Decimal::round((string) $row->selling_price, 2);
                $rawCompareAt = $row->compare_at_price === null ? null : Decimal::round((string) $row->compare_at_price, 2);
                $optionValues = is_string($row->option_values) ? (json_decode($row->option_values, true) ?: []) : [];
                $result[$row->product_id][] = [
                    'id' => $row->id,
                    'sku' => $row->sku,
                    'name' => $row->name,
                    'option_values' => $optionValues,
                    'price' => $price,
                    'compare_at_price' => Pricing::effectiveCompareAt($price, $rawCompareAt),
                    'raw_compare_at_price' => $rawCompareAt,
                    'image_id' => $row->image_id,
                    'is_active' => (bool) $row->is_active,
                ];
            }
        }

        return $result;
    }

    /**
     * Products of the organization (archived ones excluded) as the admin edits them: every
     * variant (inactive included) with its selling price, and the images.
     *
     * @param  list<string>  $productIds
     * @return array<string, array{id: string, name: string, category_id: ?string, brand_id: ?string, is_active: bool, options: list<array<string, mixed>>, images: list<array{id: string, url: string}>, variants: list<array<string, mixed>>}>
     */
    public function adminProducts(array $productIds): array
    {
        $productIds = array_values(array_unique($productIds));
        if ($productIds === []) {
            return [];
        }

        $rows = collect();
        foreach (array_chunk($productIds, self::CHUNK) as $chunk) {
            $rows = $rows->concat(DB::table('products')
                ->where('organization_id', $this->organizationId())
                ->whereIn('id', $chunk)
                ->whereNull('deleted_at')
                ->get(['id', 'name', 'category_id', 'brand_id', 'is_active', 'options']));
        }
        $ids = $rows->pluck('id')->all();
        $variants = $this->variants($ids, false);
        $images = $this->images($ids);

        $result = [];
        foreach ($rows as $row) {
            $result[$row->id] = [
                'id' => $row->id,
                'name' => $row->name,
                'category_id' => $row->category_id,
                'brand_id' => $row->brand_id,
                'is_active' => (bool) $row->is_active,
                'options' => is_string($row->options) ? (json_decode($row->options, true) ?: []) : [],
                'images' => $images[$row->id] ?? [],
                'variants' => $variants[$row->id] ?? [],
            ];
        }

        return $result;
    }

    /**
     * @param  list<string>  $productIds
     * @return array<string, list<array{id: string, url: string}>>
     */
    public function images(array $productIds): array
    {
        $result = [];
        foreach (array_chunk($productIds, self::CHUNK) as $chunk) {
            $rows = DB::table('product_images')
                ->where('organization_id', $this->organizationId())
                ->whereIn('product_id', $chunk)
                ->orderBy('sort_order')->orderBy('id')
                ->get(['id', 'product_id', 'path']);
            foreach ($rows as $row) {
                $result[$row->product_id][] = ['id' => $row->id, 'url' => '/storage/'.ltrim($row->path, '/')];
            }
        }

        return $result;
    }

    /**
     * @param  list<string>  $productIds
     * @return array<string, array{30d: string, total: string}>
     */
    private function stats(array $productIds): array
    {
        $result = [];
        foreach (array_chunk($productIds, self::CHUNK) as $chunk) {
            $rows = DB::table('product_stats')
                ->where('organization_id', $this->organizationId())
                ->whereIn('product_id', $chunk)
                ->get(['product_id', 'units_sold_30d', 'units_sold_total']);
            foreach ($rows as $row) {
                $result[$row->product_id] = [
                    '30d' => Decimal::round((string) $row->units_sold_30d, 3),
                    'total' => Decimal::round((string) $row->units_sold_total, 3),
                ];
            }
        }

        return $result;
    }

    /**
     * Sellable on-hand quantities at the fulfilment store; nothing is on hand without one.
     *
     * @param  list<string>  $variantIds
     * @return array<string, string>
     */
    private function onHand(array $variantIds): array
    {
        $store = $this->fulfilmentStoreId();
        if ($store === null || $variantIds === []) {
            return [];
        }

        $result = [];
        foreach (array_chunk($variantIds, self::CHUNK) as $chunk) {
            $result += $this->stock->onHand($store, $chunk);
        }

        return $result;
    }
}
