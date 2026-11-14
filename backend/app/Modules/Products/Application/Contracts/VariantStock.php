<?php

namespace App\Modules\Products\Application\Contracts;

use App\Modules\Shared\Application\Contracts\TenantUser;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

/**
 * P1a: what the variant grid needs from inventory, declared here and implemented by the
 * Inventory module (which already depends on Products), so stock only ever changes through
 * Inventory's own use cases. Without Inventory, `NoVariantStock` reports no stock.
 */
interface VariantStock
{
    /**
     * Stock per variant at the active stores of the branches the user may access, or null
     * when the user may not view stock. Quantities are decimal strings with 3 decimals.
     *
     * @param  list<string>  $variantIds
     * @return array<string, array{total: string, by_store: list<array{store_id: string, branch_id: string, quantity: string}>}>|null
     */
    public function levels(TenantUser $user, array $variantIds): ?array;

    /**
     * The given variants that have stock history (any ledger movement).
     *
     * @param  list<string>  $variantIds
     * @return list<string>
     */
    public function withHistory(string $organizationId, array $variantIds): array;

    /**
     * Posts opening stock (a stock adjustment with reason "opening") inside the caller's
     * transaction, valued at each variant's purchase price; returns the adjustment number.
     *
     * @param  array<string, string>  $quantities  variant id => positive quantity
     *
     * @throws AuthorizationException when the user may not adjust stock
     * @throws ValidationException keyed `store_id` or `lines.{index}.{field}` (index in $quantities order)
     */
    public function postOpening(TenantUser $actor, string $storeId, array $quantities, string $note): string;
}
