<?php

namespace App\Modules\OnlineCatalog\Tests\Concerns;

use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Catalog\Infrastructure\Models\Brand;
use App\Modules\Catalog\Infrastructure\Models\Category;
use App\Modules\Catalog\Infrastructure\Models\Unit;
use App\Modules\Inventory\Application\Actions\PostStockAdjustment;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Users\Infrastructure\Models\User;

/**
 * An open storefront with catalog records, built through the real API and use cases.
 * Use together with InteractsWithTenancy.
 */
trait BuildsOnlineCatalog
{
    /**
     * An open store on $host whose admin stays signed in, with a unit and the MAIN store.
     *
     * @return array{organization: Organization, admin: User, unit: Unit, store: Store}
     */
    protected function openStore(string $name, string $host, bool $withFulfilment = true): array
    {
        $tenant = $this->provisionTenant($name);
        $this->actingAsUser($tenant['admin']);
        $this->postJson('/api/v1/storefront/domains', ['host' => $host])->assertCreated();
        $store = Store::query()->withoutGlobalScopes()->where('organization_id', $tenant['organization']->id)->where('code', 'MAIN')->firstOrFail();
        $this->patchJson('/api/v1/storefront/settings', array_filter([
            'site_name' => $name,
            'is_enabled' => true,
            'fulfilment_store_id' => $withFulfilment ? $store->id : null,
        ], fn ($v) => $v !== null))->assertOk();
        $unit = $this->inTenant($tenant['organization'], fn () => Unit::query()->create(['name' => 'Piece', 'code' => 'pcs']));

        return $tenant + ['unit' => $unit, 'store' => $store];
    }

    protected function category(Organization $organization, string $name, ?string $parentId = null, bool $active = true): string
    {
        return $this->inTenant($organization, fn () => Category::query()->create(['name' => $name, 'parent_id' => $parentId, 'is_active' => $active])->id);
    }

    protected function brand(Organization $organization, string $name): string
    {
        return $this->inTenant($organization, fn () => Brand::query()->create(['name' => $name])->id);
    }

    /**
     * Creates a product through the products API. Variants: [sku, price, option_values?].
     *
     * @param  array<string, mixed>  $attributes
     * @param  list<array{0: string, 1: string, 2?: array<string, string>}>  $variants
     */
    protected function makeProduct(string $unitId, string $name, array $variants, array $attributes = []): array
    {
        return $this->postJson('/api/v1/products', $attributes + [
            'name' => $name,
            'type' => 'standard',
            'unit_id' => $unitId,
            'variants' => array_map(fn (array $v) => [
                'sku' => $v[0],
                'purchase_price' => '1.00',
                'selling_price' => $v[1],
                'option_values' => $v[2] ?? [],
            ], $variants),
        ])->assertCreated()->json('data');
    }

    /**
     * Publishes (or saves) a product's listing through the admin API.
     *
     * @param  array<string, mixed>  $listing
     * @return array<string, mixed> the editor payload
     */
    protected function publish(string $productId, array $listing = []): array
    {
        return $this->putJson("/api/v1/online-catalog/products/{$productId}", $listing + ['is_published' => true, 'is_featured' => false])
            ->assertOk()->json('data');
    }

    protected function listCategory(string $categoryId, array $listing = []): array
    {
        return $this->putJson("/api/v1/online-catalog/categories/{$categoryId}", $listing + ['is_visible' => true])->assertOk()->json('data');
    }

    protected function listBrand(string $brandId, array $listing = []): array
    {
        return $this->putJson("/api/v1/online-catalog/brands/{$brandId}", $listing + ['is_visible' => true])->assertOk()->json('data');
    }

    /**
     * Opening stock for variants at a store.
     *
     * @param  array<string, string>  $quantities  variant id => quantity
     */
    protected function stockUp(array $tenant, array $quantities): void
    {
        $this->inTenant($tenant['organization'], fn () => app(PostStockAdjustment::class)($tenant['admin']->fresh(), [
            'store_id' => $tenant['store']->id,
            'reason' => 'opening',
            'lines' => array_map(fn (string $id, string $qty) => ['variant_id' => $id, 'quantity' => $qty, 'unit_cost' => '1.00'], array_keys($quantities), $quantities),
        ]));
    }

    protected function asVisitor(): void
    {
        $this->app['auth']->forgetGuards();
    }
}
