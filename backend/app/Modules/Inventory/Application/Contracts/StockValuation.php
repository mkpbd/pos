<?php

namespace App\Modules\Inventory\Application\Contracts;

use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Inventory\Domain\StockRevaluation;

/**
 * SC3: cost adjustments that change the value of stock, never its quantity (landed costs
 * that arrive after the goods), and the attribution of stock on hand to the inbound
 * document that brought it. Kept apart from StockLedger so the quantity write path stays
 * one small contract.
 */
interface StockValuation
{
    /**
     * How much of what an inbound document (e.g. a goods receipt) brought into each level is
     * still on hand. The ledger keeps one weighted-average pool per store × variant × batch,
     * so units are not tracked individually; the attribution assumes the newest stock is on
     * hand (first in, first out): on hand from the document =
     *   clamp(level quantity now − inbound quantity posted to the same level after the
     *         document's movement, 0, quantity the document brought in).
     * Batch-tracked lines therefore attribute exactly when their batch is not shared.
     * With `$lock` the level rows are locked FOR UPDATE first (deterministic order).
     *
     * @param  list<array{reference_type: string, reference_id: string, store_id: string, variant_id: string, batch_id: ?string}>  $items
     * @return list<array{on_hand: string, received: string, level_quantity: string, later_inbound: string, average_cost: string}> in input order
     */
    public function onHandFromDocument(array $items, bool $lock = false): array;

    /**
     * Adds value to stock on hand without moving quantity. Locks the levels in
     * store|variant|batch order; each level must hold positive stock. The new average is
     * (quantity × average + value) / quantity at 4 dp, and one value-only movement per level
     * (quantity 0, unit_cost = the per-unit increase, value = the value added) is appended.
     *
     * @param  list<StockRevaluation>  $revaluations
     * @return list<array{movement_id: string, quantity: string, average_before: string, average_after: string}> in input order
     *
     * @throws \LogicException outside a transaction, or on a level without positive stock
     */
    public function revalue(array $revaluations, StockReference $reference): array;
}
