<?php

namespace App\Modules\Inventory\Infrastructure\Products;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Inventory\Application\Actions\PostStockAdjustment;
use App\Modules\Inventory\Domain\AdjustmentReason;
use App\Modules\Inventory\Infrastructure\Models\StockLevel;
use App\Modules\Inventory\Infrastructure\Models\StockMovement;
use App\Modules\Products\Application\Contracts\VariantStock;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Facades\Gate;

/**
 * P1a: Inventory's side of the product variant grid. Opening stock goes through the regular
 * stock adjustment use case (store access, line rules, ledger, audit).
 */
class InventoryVariantStock implements VariantStock
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly BranchDirectory $branches,
        private readonly PostStockAdjustment $adjust,
    ) {}

    public function levels(TenantUser $user, array $variantIds): ?array
    {
        if (! $user instanceof Authenticatable || ! Gate::forUser($user)->allows('inventory.view')) {
            return null;
        }

        $stores = array_values(array_filter(
            $this->branches->activeStores($this->tenant->requireOrganization()),
            fn (array $s) => $user->canAccessBranch($s['branch_id']),
        ));
        $result = [];
        foreach ($variantIds as $id) {
            $result[$id] = ['total' => '0.000', 'by_store' => []];
        }
        if ($stores === [] || $variantIds === []) {
            return $result;
        }

        $quantities = [];
        StockLevel::query()
            ->whereIn('variant_id', $variantIds)
            ->whereIn('store_id', array_column($stores, 'id'))
            ->get(['variant_id', 'store_id', 'quantity'])
            ->each(function (StockLevel $l) use (&$quantities) {
                $quantities[$l->variant_id][$l->store_id] = Decimal::add($quantities[$l->variant_id][$l->store_id] ?? '0', $l->quantity, 3);
            });

        foreach ($variantIds as $id) {
            $total = '0.000';
            foreach ($stores as $store) {
                $quantity = $quantities[$id][$store['id']] ?? '0.000';
                $total = Decimal::add($total, $quantity, 3);
                $result[$id]['by_store'][] = ['store_id' => $store['id'], 'branch_id' => $store['branch_id'], 'quantity' => $quantity];
            }
            $result[$id]['total'] = $total;
        }

        return $result;
    }

    public function withHistory(string $organizationId, array $variantIds): array
    {
        if ($variantIds === []) {
            return [];
        }

        return StockMovement::query()->withoutGlobalScope('organization')
            ->where('organization_id', $organizationId)
            ->whereIn('variant_id', $variantIds)
            ->distinct()
            ->pluck('variant_id')
            ->values()
            ->all();
    }

    public function postOpening(TenantUser $actor, string $storeId, array $quantities, string $note): string
    {
        if (! $actor instanceof Authenticatable || ! Gate::forUser($actor)->allows('inventory.adjust')) {
            throw new AuthorizationException('You may not record stock.');
        }

        $adjustment = ($this->adjust)($actor, [
            'store_id' => $storeId,
            'reason' => AdjustmentReason::Opening->value,
            'note' => $note,
            'lines' => array_map(fn (string $id, string $qty) => ['variant_id' => $id, 'quantity' => $qty], array_keys($quantities), array_values($quantities)),
        ]);

        return $adjustment->number;
    }
}
