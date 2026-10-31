<?php

namespace App\Modules\Inventory\Application\Contracts;

/**
 * Current quantities for screens that show availability (POS product grid, cart).
 * Informational only: sales are checked again under lock by the StockLedger.
 */
interface StockLevels
{
    /**
     * Sellable quantity on hand per variant in the store (expired batches excluded).
     * Variants without any stock row are reported as "0.000".
     *
     * @param  list<string>  $variantIds
     * @return array<string, string>
     */
    public function onHand(string $storeId, array $variantIds): array;
}
