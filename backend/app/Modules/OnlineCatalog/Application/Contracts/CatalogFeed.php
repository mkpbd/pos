<?php

namespace App\Modules\OnlineCatalog\Application\Contracts;

/**
 * P2b: the live catalog as product-feed items (Meta, TikTok and Pinterest catalogs), for the
 * Social module. Organization from the tenant context; names, descriptions and category paths
 * in the current language (LocaleContext).
 *
 * @phpstan-type FeedItem array{
 *   id: string, variant_id: string, item_group_id: ?string, title: string, description: string, path: string,
 *   image_urls: list<string>, in_stock: bool, price: string, sale_price: ?string, sale_ends_at: ?string,
 *   brand: ?string, product_type: ?string, color: ?string, size: ?string
 * }
 */
interface CatalogFeed
{
    /** Feeds stop after this many items. */
    public const MAX_ITEMS = 50000;

    /** Additional images per item (besides the main one). */
    public const MAX_ADDITIONAL_IMAGES = 10;

    /**
     * One item per active variant of every live product (the product itself when it has one
     * variant), products by name, variants in their order; at most $limit items.
     *
     * - `id`: the variant's SKU (its id when the SKU is empty); `item_group_id`: the product id
     *   when the product has several variants, else null.
     * - `title`: product name, plus " - <variant>" for several variants (≤ 150 characters);
     *   `description`: plain text (listing description, else short description, else the title;
     *   ≤ 5000 characters).
     * - `path`: `/product/<slug>`, with `?variant=<variant id>` for several variants.
     * - `image_urls`: the variant's photo (its own, else its photo-option value's) first, then the
     *   product's other photos — site-relative (`/storage/…`) or absolute, at most 1 + 10.
     * - `price`: the regular price (the compare-at price while it is above the selling price,
     *   else the selling price); `sale_price`: what a shopper pays now when lower (the selling
     *   price under a compare-at price, or the automatic promotion's price), else null;
     *   `sale_ends_at`: the promotion's end (ISO 8601) when one applies.
     * - `brand`: brand name or null; `product_type`: category path ("Clothes > Shirts") or null;
     *   `color` / `size`: the variant's colour / size option value when it has one.
     *
     * @return iterable<int, FeedItem>
     */
    public function items(int $limit = self::MAX_ITEMS): iterable;
}
