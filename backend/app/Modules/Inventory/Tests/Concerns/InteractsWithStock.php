<?php

namespace App\Modules\Inventory\Tests\Concerns;

use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Catalog\Infrastructure\Models\Unit;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Products\Application\Actions\SaveProduct;
use App\Modules\Products\Application\DTOs\ProductData;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Testing\TestResponse;

/**
 * Products for stock tests, created through the real SaveProduct action.
 */
trait InteractsWithStock
{
    /**
     * @param  array<string, mixed>  $overrides  product fields (e.g. track_batches, reorder via variants)
     */
    protected function stockedVariant(Organization $organization, string $name = 'Mango Juice', array $overrides = [], string $reorderLevel = '0', bool $decimalUnit = false): ProductVariant
    {
        return app(TenantContext::class)->runAs($organization->id, function () use ($name, $overrides, $reorderLevel, $decimalUnit) {
            $code = $decimalUnit ? 'kg' : 'pcs';
            $unit = Unit::query()->where('code', $code)->first()
                ?? Unit::query()->create(['name' => $decimalUnit ? 'Kilogram' : 'Piece', 'code' => $code, 'allow_decimal' => $decimalUnit]);

            $product = app(SaveProduct::class)(null, ProductData::fromArray($overrides + [
                'name' => $name,
                'type' => 'standard',
                'unit_id' => $unit->id,
                'track_stock' => true,
                'is_active' => true,
                'variants' => [['purchase_price' => '10.00', 'selling_price' => '15.00', 'reorder_level' => $reorderLevel]],
            ]));

            return $product->variants()->firstOrFail();
        });
    }

    protected function mainStoreId(Organization $organization): string
    {
        return app(TenantContext::class)->runAs($organization->id, fn () => Store::query()->where('code', 'MAIN')->orderBy('created_at')->firstOrFail()->id);
    }

    /**
     * @param  array<string, mixed>  $line
     */
    protected function adjust(string $storeId, string $reason, array $line, int $expectStatus = 201): TestResponse
    {
        return $this->postJson('/api/v1/inventory/adjustments', [
            'store_id' => $storeId,
            'reason' => $reason,
            'lines' => [$line],
        ])->assertStatus($expectStatus);
    }

    /**
     * @return array<string, mixed>|null
     */
    protected function stockRow(string $variantId, string $storeId): ?array
    {
        return collect($this->getJson("/api/v1/inventory/stock?variant_id={$variantId}&store_id={$storeId}")->assertOk()->json('data'))->first();
    }
}
