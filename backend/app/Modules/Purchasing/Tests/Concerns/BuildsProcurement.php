<?php

namespace App\Modules\Purchasing\Tests\Concerns;

use App\Modules\Branches\Infrastructure\Models\Branch;
use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Requisitions, purchase orders and RFQs through the API for SC2 tests.
 *
 * @mixin TestCase
 */
trait BuildsProcurement
{
    use BuildsSupplyChain, InteractsWithStock, InteractsWithTenancy;

    /**
     * Organization (admin = Organization Admin, all permissions), its main branch and store and
     * one product (purchase price 10.00, no tax).
     *
     * @return array{admin: User, org: Organization, branch: Branch, store: string, variant: ProductVariant}
     */
    protected function procurementWorld(string $name = 'Acme Retail'): array
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant($name);

        return [
            'admin' => $admin,
            'org' => $org,
            'branch' => $branch,
            'store' => $this->mainStoreId($org),
            'variant' => $this->stockedVariant($org, 'Mango Juice'),
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     * @param  array<string, mixed>  $extra
     */
    protected function raiseRequisition(string $store, array $lines, array $extra = [], int $status = 201): TestResponse
    {
        return $this->postJson('/api/v1/purchasing/requisitions', $extra + ['store_id' => $store, 'lines' => $lines])->assertStatus($status);
    }

    /**
     * POST with a fresh (or given) Idempotency-Key.
     *
     * @param  array<string, mixed>  $body
     */
    protected function transition(string $uri, array $body = [], ?string $key = null): TestResponse
    {
        return $this->postJson('/api/v1/purchasing/'.ltrim($uri, '/'), $body, ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
    }

    /**
     * A draft requisition for one line worth quantity × unit cost (no tax), submitted.
     */
    protected function submittedRequisition(string $store, string $variantId, string $quantity, string $unitCost): array
    {
        $id = $this->raiseRequisition($store, [['variant_id' => $variantId, 'quantity' => $quantity, 'estimated_unit_cost' => $unitCost]])->json('data.id');

        return $this->transition("requisitions/{$id}/submit")->assertOk()->json('data');
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     */
    protected function draftOrder(string $supplierId, string $store, array $lines): array
    {
        return $this->postJson('/api/v1/purchasing/orders', [
            'supplier_id' => $supplierId, 'store_id' => $store, 'order_date' => now()->toDateString(), 'lines' => $lines,
        ])->assertCreated()->json('data');
    }
}
