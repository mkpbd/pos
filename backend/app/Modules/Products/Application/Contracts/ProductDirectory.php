<?php

namespace App\Modules\Products\Application\Contracts;

/**
 * Read access to variants for modules that move or price goods (Inventory, Purchasing, POS).
 *
 * @phpstan-type VariantInfo array{
 *   variant_id: string, product_id: string, product_name: string, variant_name: ?string, sku: string,
 *   track_stock: bool, track_batches: bool, track_serials: bool, allow_decimal: bool, unit_code: ?string,
 *   tax_rate: ?string, purchase_price: string, selling_price: string, wholesale_price: ?string,
 *   price_tiers: list<array{min_quantity: string, price: string}>,
 *   packs: list<array{barcode: string, units: string, pack_name: ?string}>, reorder_level: string, weight_grams: ?int,
 *   max_discount_percent: ?string, category_id: ?string, brand_id: ?string, open_price: bool, sellable: bool
 * }
 */
interface ProductDirectory
{
    /**
     * Variants of the organization keyed by id (archived variants/products included,
     * so historical documents can still be displayed; check the flags before transacting).
     *
     * @param  list<string>  $variantIds
     * @return array<string, VariantInfo>
     */
    public function variants(string $organizationId, array $variantIds): array;

    /**
     * G1c: only the stock flags of {@see self::variants()} (same values), without loading the
     * full descriptions — for screens that first decide over every variant of a store which
     * few to show (reorder suggestions).
     *
     * @param  list<string>  $variantIds
     * @return array<string, array{track_stock: bool, sellable: bool, allow_decimal: bool}>
     */
    public function stockFlags(string $organizationId, array $variantIds): array;

    /**
     * Products of the organization that are not archived, keyed by id (unknown ids left out).
     *
     * @param  list<string>  $productIds
     * @return array<string, array{id: string, name: string}>
     */
    public function products(string $organizationId, array $productIds): array;

    /**
     * Ids of variants whose SKU, barcode or product name matches the search (for stock lists).
     *
     * @return list<string>
     */
    public function searchVariantIds(string $organizationId, string $search, int $limit = 500): array;

    /**
     * One page of sellable variants for the POS product grid, ordered by product name.
     * `search` matches name, SKU or an exact barcode; `category_ids` limits to those categories.
     *
     * @param  array{search?: ?string, category_ids?: ?list<string>}  $filters
     * @return array{items: list<VariantInfo&array{image_url: ?string}>, total: int}
     */
    public function sellablePage(string $organizationId, array $filters, int $page, int $perPage): array;

    /**
     * ST2c: the variants' selling prices at one branch, keyed by variant id (variants without a
     * branch price are left out — they sell at `selling_price`).
     *
     * @param  list<string>  $variantIds
     * @return array<string, string>
     */
    public function branchPrices(string $organizationId, string $branchId, array $variantIds): array;

    /**
     * P2b: product photos of the organization by id (unknown and other organizations' ids left
     * out), keyed by id: the product, the same-origin URL (`/storage/…`) and the file's type.
     *
     * @param  list<string>  $imageIds
     * @return array<string, array{id: string, product_id: string, url: string, mime_type: string}>
     */
    public function images(string $organizationId, array $imageIds): array;

    /**
     * ST1 (stocktake scans): the variant a scanned code names — exact barcode first, then SKU
     * (case-insensitive); archived and inactive variants included (their stock still counts).
     */
    public function variantIdByCode(string $organizationId, string $code): ?string;

    /**
     * ST1: one barcode per variant (the first one added), keyed by variant id; variants
     * without a barcode are left out. ST2c: unit barcodes only (pack barcodes are skipped).
     *
     * @param  list<string>  $variantIds
     * @return array<string, string>
     */
    public function primaryBarcodes(string $organizationId, array $variantIds): array;
}
