<?php

namespace App\Modules\OnlineCatalog\Application\Contracts;

use Carbon\CarbonImmutable;
use DateTimeInterface;

/**
 * What the Storefront module (menus, homepage sections, HTML shell) may ask the online
 * catalog. Everything is scoped to the organization in the tenant context; "visible"
 * means a category/brand with a visible listing and an active record, "live" a published
 * listing inside its schedule of an active product.
 */
interface StorefrontCatalog
{
    public const PRODUCT_SOURCES = ['featured', 'new_arrivals', 'best_sellers', 'on_sale', 'category'];

    /**
     * Product cards of live products in the given order; others are dropped.
     *
     * @param  list<string>  $productIds
     * @return list<array<string, mixed>>
     */
    public function productCards(array $productIds): array;

    /**
     * Product cards for a homepage source (one of PRODUCT_SOURCES).
     *
     * @return list<array<string, mixed>>
     */
    public function sourceProductCards(string $source, ?string $categoryId, int $limit): array;

    /**
     * Hot deals (E8b): cards of live products whose shown promotion is a live countdown
     * promotion ($promotionId only, or any), featured order, at most $limit.
     *
     * @return list<array<string, mixed>>
     */
    public function hotDealCards(?string $promotionId, int $limit): array;

    /**
     * Visible categories for a strip: the given ones in order, or the top level for null.
     *
     * @param  list<string>|null  $categoryIds
     * @return list<array{slug: string, name: string, url: string, image: ?array<string, mixed>, product_count: int}>
     */
    public function categoryStrip(?array $categoryIds, int $limit): array;

    /**
     * Visible brands for a strip: the given ones in order, or all by name for null.
     *
     * @param  list<string>|null  $brandIds
     * @return list<array{slug: string, name: string, url: string, logo: ?array<string, mixed>}>
     */
    public function brandStrip(?array $brandIds, int $limit): array;

    /**
     * @param  list<string>  $categoryIds
     * @return array<string, array{slug: string, name: string}> visible ones keyed by id
     */
    public function visibleCategories(array $categoryIds): array;

    /**
     * @param  list<string>  $brandIds
     * @return array<string, array{slug: string, name: string}> visible ones keyed by id
     */
    public function visibleBrands(array $brandIds): array;

    /**
     * The ids that exist in the organization (products: not archived), for validating
     * references kept outside foreign keys.
     *
     * @param  'product'|'category'|'brand'  $type
     * @param  list<string>  $ids
     * @return list<string>
     */
    public function existing(string $type, array $ids): array;

    /**
     * Link-picker data: every category (tree order) and brand with its storefront path,
     * null while it has no visible listing.
     *
     * @return array{
     *   categories: list<array{id: string, name: string, url: ?string, parent_id: ?string, depth: int}>,
     *   brands: list<array{id: string, name: string, url: ?string}>
     * }
     */
    public function linkTargets(): array;

    /**
     * Admin display data of hand-picked records (archived products excluded), keyed by id.
     *
     * @param  'product'|'category'|'brand'  $type
     * @param  list<string>  $ids
     * @return array<string, array{id: string, name: string, image_url: ?string}>
     */
    public function itemSummaries(string $type, array $ids): array;

    /**
     * What the cart needs to price and show its lines, keyed by variant id (variants of other
     * organizations or unknown ids are left out; archived products/variants are included as
     * not purchasable). `purchasable` = live listing, active product, active variant.
     * `brand_id` / `category_id` feed the promotion rules (E8b).
     * `max_quantity` is the sellable on-hand quantity at the fulfilment store for stock-tracked
     * products (no fulfilment store = nothing on hand), null when stock is not tracked.
     *
     * @param  list<string>  $variantIds
     * @return array<string, array{
     *   variant_id: string, product_id: string, brand_id: ?string, category_id: ?string, product_slug: ?string, product_name: string,
     *   variant_name: ?string, option_values: array<string, string>, sku: string,
     *   image: ?array{url: string, alt: string}, price: string, compare_at_price: ?string,
     *   purchasable: bool, in_stock: bool, max_quantity: ?string, allow_decimal: bool, tax_rate: string
     * }>
     */
    public function variantsForCart(array $variantIds): array;

    /**
     * The id of the live product at a storefront address (case-insensitive slug), or null.
     */
    public function liveProductId(string $slug): ?string;

    /**
     * Display data of products (archived ones included, other organizations' left out) keyed
     * by id: name, first image and the storefront slug while the product is live (else null).
     * Used for review lists (E9).
     *
     * @param  list<string>  $productIds
     * @return array<string, array{id: string, name: string, slug: ?string, image_url: ?string}>
     */
    public function productSummaries(array $productIds): array;

    /**
     * Search metadata for the HTML shell, or null when the page does not exist: title,
     * description (SEO description or a plain-text excerpt ≤ 160), first image, name and
     * breadcrumbs (categories, brands); products add `product`, the schema.org data
     * (ProductPage::structuredData) — E12.
     *
     * @param  'category'|'brand'|'product'  $type
     * @return array{title: string, description: ?string, image_url: ?string, name: string, breadcrumbs: list<array{name: string, url: string}>, product?: array<string, mixed>}|null
     */
    public function pageMeta(string $type, string $slug): ?array;

    /**
     * The next instant a listing schedule or a live automatic promotion starts or ends, or
     * null: cached storefront pages showing products expire then (E12).
     */
    public function nextScheduledChange(): ?CarbonImmutable;

    /**
     * Sitemap entries (E12), each by slug: live products with their last change and first
     * image (site-relative URL), visible categories and visible brands.
     *
     * @param  'product'|'category'|'brand'  $type
     * @return list<array{slug: string, updated_at: ?DateTimeInterface, image_url?: ?string, name?: string}>
     */
    public function sitemapEntries(string $type): array;

    /**
     * B4: the slug of the live product whose listing changed last, or null when nothing is on
     * sale online (the store builder previews the product page zone on it).
     */
    public function latestProductSlug(): ?string;
}
