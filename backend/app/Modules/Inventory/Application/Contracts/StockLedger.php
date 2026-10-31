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
     * one ledger movement per change and returns the movements in input order.
     * Services and other untracked variants are skipped (null in the result).
     *
     * @param  list<StockChange>  $changes
     * @return list<array{movement_id: string, unit_cost: string, balance_after: string}|null>
     *
     * @throws BusinessRuleViolation INSUFFICIENT_STOCK, STORE_INACTIVE
     */
    public function post(array $changes, StockReference $reference): array;
}
