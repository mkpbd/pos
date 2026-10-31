<?php

namespace App\Modules\Inventory\Application\Contracts;

use App\Modules\Inventory\Domain\StockChange;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * The only way stock quantities change. Other modules (Purchasing, POS, Returns) call it
 * inside their own transaction so that the document and its stock movements commit or
 * roll back together.
 */
interface StockLedger
{
    /**
     * Locks the affected stock levels in deterministic order, applies the changes, writes
     * one ledger movement per change (per batch for allocated changes) and returns the
     * result in input order. Services and other untracked variants are skipped (null).
     *
     * `unit_cost` is the cost of the whole change (weighted over its batches);
     * `allocations` lists what was taken from or added to each batch.
     *
     * @param  list<StockChange>  $changes
     * @return list<array{
     *   movement_id: string, unit_cost: string, balance_after: string,
     *   allocations: list<array{batch_id: ?string, quantity: string, unit_cost: string, movement_id: string}>
     * }|null>
     *
     * @throws BusinessRuleViolation INSUFFICIENT_STOCK, STORE_INACTIVE, UNKNOWN_PRODUCT
     */
    public function post(array $changes, StockReference $reference): array;
}
