<?php

namespace App\Modules\OnlineCatalog\Infrastructure\ReadModels;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\Inventory\Application\Contracts\StockLevels;
use App\Modules\OnlineCatalog\Application\Contracts\ProductRatings;
use App\Modules\OnlineCatalog\Domain\CatalogItem;
use App\Modules\OnlineCatalog\Domain\CategoryTree;
use App\Modules\OnlineCatalog\Domain\ListingState;
use App\Modules\OnlineCatalog\Domain\Pricing;
use App\Modules\OnlineCatalog\Infrastructure\Models\BrandListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\CategoryListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\ProductListing;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Promotions\Application\Contracts\CatalogPromotions;
use App\Modules\Shared\Application\Contracts\StorefrontContentVersion;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Translations;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\VideoUrl;
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
 * E12b: names are in the request's language (LocaleContext): a product's `name` is its
 * listing's translated name, else the product's name; category and brand names come from
 * their listings' translations the same way. Listing texts are read with
 * Translations::pick(). Search matches base and Bangla names.
 *
 * @phpstan-type VariantRecord array{id: string, sku: string, name: ?string, option_values: array<string, string>, price: string, compare_at_price: ?string, raw_compare_at_price: ?string, image_id: ?string, is_active: bool, tracked: bool, in_stock: bool, low_stock: bool, stock_left: ?int}
 * @phpstan-type ProductRecord array{id: string, name: string, base_name?: string, category_id: ?string, brand_id: ?string, unit_id: ?string, options: list<array{name: string, values: list<string>}>, is_active: bool, listing: ProductListing, variants: list<VariantRecord>, images: list<array{id: string, url: string}>, photo_option: ?string, option_styles: array<string, string>, option_images: array<string, array<string, list<string>>>, units_sold_30d: string, units_sold_total: string, rating?: array{average: string, count: int}|null}
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
        private readonly CatalogPromotions $promotions,
        private readonly ProductRatings $ratings,
        private readonly StorefrontContentVersion $version,
        private readonly LocaleContext $locale,
    ) {}

    public function locale(): string
    {
        return $this->locale->current();
    }

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
        // E12: the live candidate set of the shop, category and homepage listings is cached per
        // organization content version (search, id and slug lookups are not: unbounded keys).
        $cacheable = ($options['live'] ?? true) && array_diff(array_keys($options), ['category_ids', 'live']) === [];
        if ($cacheable) {
            $ids = $options['category_ids'] ?? null;
            if (is_array($ids)) {
                sort($ids);
            }

            // The cache never holds Eloquent objects: unserializing them is refused
            // (`cache.serializable_classes` = false), so a listing travels as its raw attributes.
            $cached = $this->version->remember(
                $this->organizationId(),
                'catalog:products:'.hash('xxh128', (string) json_encode($ids)),
                fn () => array_map(fn (array $record) => ['listing' => $record['listing']->getAttributes()] + $record, $this->loadProducts($options)),
                fn () => $this->nextListingChange(),
            );

            return $this->localize(array_map(fn (array $record) => ['listing' => (new ProductListing)->newFromBuilder($record['listing'])] + $record, $cached));
        }

        return $this->localize($this->loadProducts($options));
    }

    /**
     * Product names in the request's language (E12b); `base_name` keeps the product's own.
     *
     * @param  list<ProductRecord>  $records
     * @return list<ProductRecord>
     */
    private function localize(array $records): array
    {
        $locale = $this->locale->current();

        return array_map(function (array $record) use ($locale) {
            $record['base_name'] = $record['name'];
            $record['name'] = (string) Translations::value($record['listing']->translations, 'name', $locale, $record['name']);

            return $record;
        }, $records);
    }

    /**
     * The next instant a published listing's schedule starts or ends (after now), or null.
     */
    public function nextListingChange(): ?CarbonImmutable
    {
        $now = now();
        $base = fn () => DB::table('product_listings')->where('organization_id', $this->organizationId())->where('is_published', true);

        return self::earliest([
            $base()->where('published_at', '>', $now)->min('published_at'),
            $base()->where('unpublished_at', '>', $now)->min('unpublished_at'),
        ]);
    }

    /**
     * The next instant a listing window or a live automatic promotion starts or ends: what
     * cached storefront pages showing products must not outlive.
     */
    public function nextScheduledChange(): ?CarbonImmutable
    {
        return self::earliest([$this->nextListingChange(), $this->promotions->nextChangeAt()]);
    }

    /**
     * Live products for the sitemap (E12), by slug: slug, last change (listing or product) and
     * the first image path. A product needs an active variant to be live, as on the storefront.
     *
     * @return list<array{slug: string, name: string, updated_at: ?CarbonImmutable, image_url: ?string}>
     */
    public function sitemapProducts(): array
    {
        $rows = $this->liveListings()
            ->orderBy('pl.slug')
            ->get(['pl.product_id', 'pl.slug', 'pl.updated_at', 'p.updated_at as product_updated_at', 'p.name']);

        $images = $this->images($rows->pluck('product_id')->all());

        return $rows->map(fn ($row) => [
            'slug' => (string) $row->slug,
            'name' => (string) $row->name,
            'updated_at' => self::earliest([$row->updated_at, $row->product_updated_at], latest: true),
            'image_url' => $images[$row->product_id][0]['url'] ?? null,
        ])->all();
    }

    /**
     * B4: the slug of the live product whose listing changed last, or null (store builder
     * preview of the product page zone). P1b: `$categoryId` limits it to that category and its
     * subcategories (preview of a category-targeted zone).
     */
    public function latestProductSlug(?string $categoryId = null): ?string
    {
        $query = $this->liveListings();
        if ($categoryId !== null) {
            $ids = $this->categoryTree()->withDescendants($categoryId);
            if ($ids === []) {
                return null;
            }
            $query->whereIn('p.category_id', $ids);
        }
        $slug = $query->orderByDesc('pl.updated_at')->orderBy('pl.slug')->value('pl.slug');

        return $slug === null ? null : (string) $slug;
    }

    /**
     * Listings of live products (published, inside their schedule, an active product with an
     * active variant), as `pl` joined to `p`.
     */
    private function liveListings(): QueryBuilder
    {
        $org = $this->organizationId();
        $now = now();

        return DB::table('product_listings as pl')
            ->join('products as p', 'p.id', '=', 'pl.product_id')
            ->where('pl.organization_id', $org)
            ->where('p.organization_id', $org)
            ->whereNull('p.deleted_at')
            ->where('p.is_active', true)
            ->where('pl.is_published', true)
            ->where(fn (QueryBuilder $q) => $q->whereNull('pl.published_at')->orWhere('pl.published_at', '<=', $now))
            ->where(fn (QueryBuilder $q) => $q->whereNull('pl.unpublished_at')->orWhere('pl.unpublished_at', '>', $now))
            ->whereExists(fn (QueryBuilder $s) => $s->from('product_variants as v')
                ->whereColumn('v.product_id', 'p.id')->where('v.organization_id', $org)->whereNull('v.deleted_at')->where('v.is_active', true));
    }

    /**
     * The earliest (or latest) of some instants; nulls are ignored.
     *
     * @param  list<mixed>  $times  date strings, DateTimeInterface or null
     */
    public static function earliest(array $times, bool $latest = false): ?CarbonImmutable
    {
        $stamps = [];
        foreach ($times as $time) {
            if ($time instanceof \DateTimeInterface) {
                $stamps[] = $time->getTimestamp();
            } elseif (is_string($time) && $time !== '') {
                $stamps[] = CarbonImmutable::parse($time)->getTimestamp();
            }
        }
        if ($stamps === []) {
            return null;
        }

        return CarbonImmutable::createFromTimestamp($latest ? max($stamps) : min($stamps));
    }

    /**
     * @param  array{ids?: list<string>, slug?: string, slugs?: list<string>, q?: ?string, category_ids?: list<string>, live?: bool, include_inactive_variants?: bool}  $options
     * @return list<ProductRecord>
     */
    private function loadProducts(array $options): array
    {
        $org = $this->organizationId();
        $live = $options['live'] ?? true;

        $query = ProductListing::query()->withoutGlobalScope('organization')
            ->join('products as p', 'p.id', '=', 'product_listings.product_id')
            ->where('product_listings.organization_id', $org)
            ->where('p.organization_id', $org)
            ->whereNull('p.deleted_at')
            ->select('product_listings.*', 'p.name as p_name', 'p.category_id as p_category_id', 'p.brand_id as p_brand_id',
                'p.unit_id as p_unit_id', 'p.type as p_type', 'p.track_stock as p_track_stock', 'p.options as p_options', 'p.is_active as p_is_active',
                'p.photo_option as p_photo_option', 'p.option_styles as p_option_styles');

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
        $optionImages = $this->optionImages($productIds);
        $stats = $this->stats($productIds);
        // E10b: approved-review ratings of all candidates in one query (cards, "top rated" sort).
        $ratings = $this->ratings->summaries($productIds);

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
                // P1a: whole units left, only when few are left (never the exact stock of well-stocked items).
                $whole = (int) Decimal::floor($qty, 0);
                $row['stock_left'] = $row['low_stock'] && $whole > 0 ? $whole : null;
                $productVariants[] = $row;
            }
            if ($live && $productVariants === []) {
                // Nothing to sell: not shown.
                continue;
            }

            $options = $listing->getAttribute('p_options');
            $styles = $listing->getAttribute('p_option_styles');
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
                // P1a: photos by colour and swatch styles.
                'photo_option' => $listing->getAttribute('p_photo_option'),
                'option_styles' => is_string($styles) ? (json_decode($styles, true) ?: []) : ($styles ?? []),
                'option_images' => $optionImages[$listing->product_id] ?? [],
                'units_sold_30d' => $stats[$listing->product_id]['30d'] ?? '0.000',
                'units_sold_total' => $stats[$listing->product_id]['total'] ?? '0.000',
                'rating' => $ratings[$listing->product_id] ?? null,
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
            // Lets a card add a single-variant product to the cart; null when options must be chosen.
            'default_variant_id' => count($variants) === 1 ? $variants[0]['id'] : null,
            'short_description' => Translations::pick($listing, 'short_description', $this->locale->current()),
            // Live automatic promotion of the variant giving `price` (E8b): {id, name, type, value, ends_at, show_countdown, price}.
            'promotion' => $variants === [] ? null : $this->promotion($record, $pricing['price']),
            // E10b: {average (one decimal), count} of the approved reviews, null when unrated.
            'rating' => $record['rating'] ?? null,
            // P1a: colour chips (≤ 5, `more` = the rest) with each value's first photo.
            'swatches' => $this->swatches($record),
            // P1b: the listing's custom badges [{text, tone}] in the request's language.
            'badges' => $this->badges($listing),
        ];
    }

    /**
     * P1b: a listing's custom badges (≤ 2) as shoppers see them: `[{text, tone}]`, the text in
     * the request's language (per-field fallback to the base text).
     *
     * @return list<array{text: string, tone: string}>
     */
    public function badges(ProductListing $listing): array
    {
        $locale = $this->locale->current();
        $result = [];
        foreach (array_slice(array_values(is_array($listing->badges) ? $listing->badges : []), 0, ProductListing::MAX_BADGES) as $badge) {
            if (! is_array($badge) || ! is_string($badge['text'] ?? null) || trim($badge['text']) === '' || ! in_array($badge['tone'] ?? null, ProductListing::BADGE_TONES, true)) {
                continue;
            }
            $result[] = [
                'text' => (string) Translations::value($badge['translations'] ?? null, 'text', $locale, $badge['text']),
                'tone' => $badge['tone'],
            ];
        }

        return $result;
    }

    /**
     * P1b: the listing's video `{provider, id, url}` (YouTube / Vimeo), or null.
     *
     * @return array{provider: string, id: string, url: string}|null
     */
    public function video(ProductListing $listing): ?array
    {
        $parsed = VideoUrl::parse($listing->video_url);

        return $parsed === null ? null : ['provider' => $parsed['provider'], 'id' => $parsed['video_id'], 'url' => (string) $listing->video_url];
    }

    /**
     * The automatic promotion shown for one unit at $unitPrice (promotional `price`), or null.
     * Listing filters and sorting keep the base price (E8b).
     *
     * @param  ProductRecord  $record
     * @return ?array{id: string, name: string, type: string, value: string, ends_at: ?string, show_countdown: bool, price: string}
     */
    public function promotion(array $record, string $unitPrice): ?array
    {
        return $this->promotions->bestFor($record['id'], $record['brand_id'], $record['category_id'], $unitPrice);
    }

    /**
     * Live countdown promotions with their targets (hot deals).
     *
     * @return list<array{id: string, ends_at: string, product_ids: list<string>, category_ids: list<string>, brand_ids: list<string>}>
     */
    public function countdownPromotions(?string $promotionId): array
    {
        return $this->promotions->countdownPromotions($promotionId);
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
            ratingAverage: $record['rating']['average'] ?? null,
            ratingCount: $record['rating']['count'] ?? 0,
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
            $locale = $this->locale->current();
            $listings = $this->categoryListings();
            $categories = array_map(function (array $c) use ($listings, $locale) {
                $c['base_name'] = $c['name'];
                $c['name'] = (string) Translations::value(($listings[$c['id']] ?? null)?->translations, 'name', $locale, $c['name']);

                return $c;
            }, $this->catalog->categories($this->organizationId()));
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
        if ($this->brands === null) {
            $locale = $this->locale->current();
            $listings = $this->brandListings();
            $this->brands = [];
            foreach ($this->catalog->brands($this->organizationId()) as $brand) {
                $brand['base_name'] = $brand['name'];
                $brand['name'] = (string) Translations::value(($listings[$brand['id']] ?? null)?->translations, 'name', $locale, $brand['name']);
                $this->brands[$brand['id']] = $brand;
            }
        }

        return $this->brands;
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
     * Case-insensitive substring match on product name, any live SKU or the brand name —
     * base and Bangla names (the listings' translations, E12b) in every language.
     *
     * @param  Builder<ProductListing>  $query
     */
    private function applySearch(Builder $query, string $q): void
    {
        $like = '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], mb_strtolower(trim($q))).'%';
        $grammar = $query->getQuery()->getGrammar();
        $translated = fn (string $column) => 'lower('.$grammar->wrap($column.'->'.LocaleContext::BN.'->name').')';

        $query->where(fn (Builder $w) => $w
            ->whereRaw("lower(p.name) like ? escape '!'", [$like])
            ->orWhereRaw($translated('product_listings.translations')." like ? escape '!'", [$like])
            ->orWhereExists(fn (QueryBuilder $s) => $s->from('brand_listings as sbl')
                ->whereColumn('sbl.brand_id', 'p.brand_id')
                ->whereRaw($translated('sbl.translations')." like ? escape '!'", [$like]))
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
     * P1a: ordered image ids per option value, keyed by lower-case option name and value.
     *
     * @param  list<string>  $productIds
     * @return array<string, array<string, array<string, list<string>>>>
     */
    private function optionImages(array $productIds): array
    {
        $result = [];
        foreach (array_chunk($productIds, self::CHUNK) as $chunk) {
            $rows = DB::table('product_option_images')
                ->where('organization_id', $this->organizationId())
                ->whereIn('product_id', $chunk)
                ->orderBy('sort_order')->orderBy('id')
                ->get(['product_id', 'option_name', 'option_value', 'image_id']);
            foreach ($rows as $row) {
                $result[$row->product_id][mb_strtolower($row->option_name)][mb_strtolower($row->option_value)][] = $row->image_id;
            }
        }

        return $result;
    }

    /**
     * P1a: the product's options with the values its active variants use, in dictionary order
     * (a linked attribute gives slug, display, value order and swatch colours). `display` is the
     * product's own style (color → swatch, image, button) or else the attribute's display.
     * Values of the photo option carry their photos (`image` is the first).
     *
     * @param  ProductRecord  $record
     * @return list<array{name: string, slug: ?string, display: string, values: list<array{value: string, swatch_hex: ?string, image: array{id: string, url: string, alt: string}|null, image_ids: list<string>}>}>
     */
    public function productOptions(array $record): array
    {
        $attributes = [];
        foreach ($this->attributes() as $attribute) {
            $attributes[mb_strtolower($attribute['name'])] = $attribute;
        }
        $styles = array_change_key_case($record['option_styles'] ?? [], CASE_LOWER);
        $photoOption = mb_strtolower((string) ($record['photo_option'] ?? ''));
        $imagesById = array_column($record['images'], null, 'id');
        $variants = $this->activeVariants($record);

        $result = [];
        foreach ($record['options'] as $option) {
            $name = (string) ($option['name'] ?? '');
            $key = mb_strtolower($name);
            $used = [];
            foreach ($variants as $variant) {
                foreach ($variant['option_values'] as $optionName => $value) {
                    if (mb_strtolower((string) $optionName) === $key) {
                        $used[mb_strtolower((string) $value)] = true;
                    }
                }
            }
            $values = array_values(array_filter((array) ($option['values'] ?? []), fn ($v) => isset($used[mb_strtolower((string) $v)])));

            $attribute = $attributes[$key] ?? null;
            $swatches = [];
            if ($attribute !== null) {
                $order = [];
                foreach ($attribute['values'] as $position => $known) {
                    $order[mb_strtolower($known['value'])] = $position;
                    $swatches[mb_strtolower($known['value'])] = $known['swatch_hex'];
                }
                $fallback = count($order);
                $indexed = array_map(null, $values, array_keys($values));
                usort($indexed, fn (array $a, array $b) => [$order[mb_strtolower((string) $a[0])] ?? $fallback, $a[1]] <=> [$order[mb_strtolower((string) $b[0])] ?? $fallback, $b[1]]);
                $values = array_column($indexed, 0);
            }

            $photos = $photoOption !== '' && $photoOption === $key ? ($record['option_images'][$key] ?? []) : [];
            $result[] = [
                'name' => $name,
                'slug' => $attribute['slug'] ?? null,
                'display' => match ($styles[$key] ?? null) {
                    'color' => 'swatch',
                    'image' => 'image',
                    'button' => 'button',
                    default => $attribute['display'] ?? 'button',
                },
                'values' => array_map(function ($v) use ($swatches, $photos, $imagesById, $record) {
                    $ids = array_values(array_filter($photos[mb_strtolower((string) $v)] ?? [], fn (string $id) => isset($imagesById[$id])));

                    return [
                        'value' => (string) $v,
                        'swatch_hex' => $swatches[mb_strtolower((string) $v)] ?? null,
                        'image' => $ids === [] ? null : ['id' => $ids[0], 'url' => $imagesById[$ids[0]]['url'], 'alt' => $record['name'].' — '.$v],
                        'image_ids' => $ids,
                    ];
                }, $values),
            ];
        }

        return $result;
    }

    /**
     * P1a: the photo option, or else the first option drawn as colour chips, for product cards:
     * at most five values (with their first photo) and how many more there are.
     *
     * @param  ProductRecord  $record
     * @return array{option: string, values: list<array{value: string, swatch_hex: ?string, image: array{url: string, alt: string}|null}>, more: int}|null
     */
    public function swatches(array $record): ?array
    {
        if (($record['options'] ?? []) === []) {
            return null;
        }
        $options = $this->productOptions($record);
        $photoOption = mb_strtolower((string) ($record['photo_option'] ?? ''));
        $chosen = null;
        foreach ($options as $option) {
            if ($photoOption !== '' && mb_strtolower($option['name']) === $photoOption) {
                $chosen = $option;
                break;
            }
        }
        foreach ($chosen === null ? $options : [] as $option) {
            if ($option['display'] === 'swatch') {
                $chosen = $option;
                break;
            }
        }
        if ($chosen === null || $chosen['values'] === []) {
            return null;
        }

        return [
            'option' => $chosen['name'],
            'values' => array_map(fn (array $v) => [
                'value' => $v['value'],
                'swatch_hex' => $v['swatch_hex'],
                'image' => $v['image'] === null ? null : ['url' => $v['image']['url'], 'alt' => $v['image']['alt']],
            ], array_slice($chosen['values'], 0, 5)),
            'more' => max(0, count($chosen['values']) - 5),
        ];
    }

    /**
     * A variant's label: its own name, else its option values ("Red / L"), else the product's name.
     *
     * @param  array<string, mixed>  $variant
     */
    public static function variantLabel(string $productName, array $variant): string
    {
        if (is_string($variant['name'] ?? null) && $variant['name'] !== '') {
            return $variant['name'];
        }
        $values = (array) ($variant['option_values'] ?? []);

        return $values !== [] ? implode(' / ', array_map('strval', array_values($values))) : $productName;
    }

    /**
     * The storefront's site name (e-mails), or null before it is set up.
     */
    public function siteName(): ?string
    {
        $name = DB::table('storefront_settings')->where('organization_id', $this->organizationId())->value('site_name');

        return is_string($name) && $name !== '' ? $name : null;
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
