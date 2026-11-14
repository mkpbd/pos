<?php

namespace App\Modules\Inventory\Application\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;

/**
 * P1a: a store's quantity of some variants went from zero or less to above zero (any inbound
 * movement: opening stock, adjustment, purchase receipt, transfer in, return, cancellation).
 * Dispatched after commit, once per posting and store, only for the variants that crossed.
 * Listeners recheck the sellable quantity themselves (expired batches are not sellable).
 */
final readonly class StockBecameAvailable implements ShouldDispatchAfterCommit
{
    /**
     * @param  list<string>  $variantIds
     */
    public function __construct(
        public string $organizationId,
        public string $branchId,
        public string $storeId,
        public array $variantIds,
    ) {}
}
