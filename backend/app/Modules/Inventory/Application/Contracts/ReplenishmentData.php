<?php

namespace App\Modules\Inventory\Application\Contracts;

use Carbon\CarbonImmutable;

/**
 * Inventory inputs of reorder suggestions (SC1): replenishment settings, and per store the
 * quantity on hand, inbound transfers, net units sold and the effective reorder rule.
 * Read-only; quantities are decimal strings with 3 decimals.
 */
interface ReplenishmentData
{
    /**
     * The organization's settings (defaults when never saved).
     *
     * @return array{source_store_id: ?string, coverage_days: int, velocity_days: int, safety_days: int}
     */
    public function settings(string $organizationId): array;

    /**
     * Per variant of the store: on hand (all batches), in transit (dispatched transfers into
     * the store not yet received), net units sold since `$since` (sales and web orders minus
     * returns and cancellations, from the stock ledger, never below zero) and the effective
     * rule — the store's active reorder rule, else the variant's reorder level as min and no max.
     *
     * Without `$variantIds` the candidates are variants with an active rule in the store, a
     * reorder level above zero, sales since `$since` or negative stock; with them exactly
     * those variants are returned (zeros where nothing is recorded).
     *
     * @param  list<string>|null  $variantIds
     * @return array<string, array{on_hand: string, in_transit: string, sold: string, min_qty: string, max_qty: ?string, has_rule: bool}>
     */
    public function storeInputs(string $organizationId, string $storeId, CarbonImmutable $since, ?array $variantIds = null): array;
}
