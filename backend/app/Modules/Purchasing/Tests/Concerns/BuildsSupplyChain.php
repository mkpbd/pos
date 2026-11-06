<?php

namespace App\Modules\Purchasing\Tests\Concerns;

use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Suppliers\Infrastructure\Models\Supplier;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

/**
 * Suppliers and catalog rows for supply chain tests (SC1).
 */
trait BuildsSupplyChain
{
    /**
     * @param  array<string, mixed>  $attributes
     */
    protected function supplier(Organization $org, string $name = 'Pran Distribution', array $attributes = []): Supplier
    {
        return app(TenantContext::class)->runAs($org->id, fn () => Supplier::query()->create($attributes + [
            'code' => 'SUP-'.Str::upper(Str::random(6)), 'name' => $name, 'payment_terms_days' => 30, 'is_active' => true,
        ]));
    }

    /**
     * Adds a catalog row through the API as the authenticated user.
     *
     * @param  array<string, mixed>  $fields
     */
    protected function catalogRow(string $supplierId, string $variantId, array $fields = [], int $status = 201): TestResponse
    {
        return $this->postJson('/api/v1/purchasing/supplier-products', $fields + [
            'supplier_id' => $supplierId,
            'variant_id' => $variantId,
            'unit_cost' => '10.5',
        ])->assertStatus($status);
    }
}
