<?php

namespace App\Modules\Products\Application\Contracts;

/**
 * Read access to variants for modules that move or price goods (Inventory, Purchasing, POS).
 */
interface ProductDirectory
{
    /**
     * Variants of the organization keyed by id (archived variants/products included,
     * so historical documents can still be displayed; check the flags before transacting).
     *
     * @param  list<string>  $variantIds
     * @return array<string, array{
     *   variant_id: string, product_id: string, product_name: string, variant_name: ?string, sku: string,
     *   track_stock: bool, track_batches: bool, track_serials: bool, allow_decimal: bool, unit_code: ?string,
     *   tax_rate: ?string, purchase_price: string, selling_price: string, reorder_level: string, sellable: bool
     * }>
     */
    public function variants(string $organizationId, array $variantIds): array;

    /**
     * Ids of variants whose SKU, barcode or product name matches the search (for stock lists).
     *
     * @return list<string>
     */
    public function searchVariantIds(string $organizationId, string $search, int $limit = 500): array;
}
