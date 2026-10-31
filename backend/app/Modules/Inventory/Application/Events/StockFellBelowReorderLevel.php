<?php

namespace App\Modules\Inventory\Application\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;

/**
 * A store's quantity of a variant dropped to or below its reorder level (dispatched after commit,
 * only when the threshold is crossed, so a busy item does not raise an alert on every sale).
 */
final readonly class StockFellBelowReorderLevel implements ShouldDispatchAfterCommit
{
    public function __construct(
        public string $organizationId,
        public string $branchId,
        public string $storeId,
        public string $variantId,
        public string $quantity,
        public string $reorderLevel,
    ) {}
}
