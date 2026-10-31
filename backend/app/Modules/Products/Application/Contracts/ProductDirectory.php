<?php

namespace App\Modules\Products\Application\Contracts;

/**
 * Read access to variants for modules that move or price goods (Inventory, Purchasing, POS).
 *
 * @phpstan-type VariantInfo array{
 *   variant_id: string, product_id: string, product_name: string, variant_name: ?string, sku: string,
 *   track_stock: bool, track_batches: bool, track_serials: bool, allow_decimal: bool, unit_code: ?string,
 *   tax_rate: ?string, purchase_price: string, selling_price: string, reorder_level: string,
 *   max_discount_percent: ?string, category_id: ?string, sellable: bool
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
}
