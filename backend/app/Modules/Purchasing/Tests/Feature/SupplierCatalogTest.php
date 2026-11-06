<?php

namespace App\Modules\Purchasing\Tests\Feature;

use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Purchasing\Infrastructure\Models\SupplierProduct;
use App\Modules\Purchasing\Tests\Concerns\BuildsSupplyChain;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * SC1: the supplier catalog — CRUD, one preferred supplier per variant, the PO lookup,
 * last purchase cost from goods receipts, permissions and tenant isolation.
 */
class SupplierCatalogTest extends TestCase
{
    use BuildsSupplyChain, InteractsWithStock, InteractsWithTenancy, RefreshDatabase;

    public function test_catalog_crud_with_list_filters_and_shapes(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $juice = $this->stockedVariant($org, 'Mango Juice');
        $rice = $this->stockedVariant($org, 'Miniket Rice', decimalUnit: true);
        $pran = $this->supplier($org, 'Pran');
        $mills = $this->supplier($org, 'Local Mills');
        $this->actingAsUser($admin);

        $row = $this->catalogRow($pran->id, $juice->id, ['supplier_sku' => ' PR-250 ', 'unit_cost' => '18.25', 'pack_size' => '24', 'min_order_qty' => '48', 'lead_time_days' => 3, 'is_preferred' => true])
            ->assertJsonPath('data.supplier.name', 'Pran')
            ->assertJsonPath('data.variant.product_name', 'Mango Juice')
            ->assertJsonPath('data.variant.unit', 'pcs')
            ->assertJsonPath('data.supplier_sku', 'PR-250')
            ->assertJsonPath('data.unit_cost', '18.2500')
            ->assertJsonPath('data.pack_size', '24.000')
            ->assertJsonPath('data.min_order_qty', '48.000')
            ->assertJsonPath('data.lead_time_days', 3)
            ->assertJsonPath('data.is_preferred', true)
            ->assertJsonPath('data.last_purchase_cost', null)
            ->assertJsonPath('data.is_active', true)
            ->json('data');
        $defaults = $this->catalogRow($mills->id, $rice->id, ['pack_size' => '2.5'])
            ->assertJsonPath('data.lead_time_days', 7)
            ->assertJsonPath('data.pack_size', '2.500')
            ->assertJsonPath('data.is_preferred', false)
            ->json('data');

        $this->getJson('/api/v1/purchasing/supplier-products')->assertOk()
            ->assertJsonPath('meta.pagination.total', 2)
            ->assertJsonPath('data.0.variant.product_name', 'Mango Juice') // ordered by product name
            ->assertJsonPath('data.1.variant.product_name', 'Miniket Rice');
        $this->getJson("/api/v1/purchasing/supplier-products?supplier_id={$mills->id}")->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $defaults['id']);
        $this->getJson("/api/v1/purchasing/supplier-products?variant_id={$juice->id}")->assertJsonCount(1, 'data');
        $this->getJson('/api/v1/purchasing/supplier-products?search=PR-2')->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $row['id']);
        $this->getJson('/api/v1/purchasing/supplier-products?search=rice')->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $defaults['id']);
        $this->getJson('/api/v1/purchasing/supplier-products?is_preferred=1')->assertJsonCount(1, 'data');
        $this->getJson('/api/v1/purchasing/supplier-products?sort=-unit_cost')->assertJsonPath('data.0.id', $row['id']);
        $this->getJson('/api/v1/purchasing/supplier-products?sort=name')->assertStatus(422);

        $this->patchJson("/api/v1/purchasing/supplier-products/{$row['id']}", ['unit_cost' => '19', 'lead_time_days' => 5, 'supplier_sku' => null])->assertOk()
            ->assertJsonPath('data.unit_cost', '19.0000')
            ->assertJsonPath('data.lead_time_days', 5)
            ->assertJsonPath('data.supplier_sku', null)
            ->assertJsonPath('data.is_preferred', true);
        $this->patchJson("/api/v1/purchasing/supplier-products/{$row['id']}", ['variant_id' => $rice->id])->assertStatus(422);
        $this->patchJson("/api/v1/purchasing/supplier-products/{$row['id']}", ['last_purchase_cost' => '1'])->assertStatus(422);

        $this->deleteJson("/api/v1/purchasing/supplier-products/{$defaults['id']}")->assertNoContent();
        $this->getJson('/api/v1/purchasing/supplier-products')->assertJsonPath('meta.pagination.total', 1);
    }

    public function test_validation_rules(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $juice = $this->stockedVariant($org, 'Mango Juice');
        $pran = $this->supplier($org, 'Pran');
        $sleeping = $this->supplier($org, 'Dormant', ['is_active' => false]);
        $this->actingAsUser($admin);

        $this->catalogRow($pran->id, $juice->id, ['pack_size' => '0.5'], 422)->assertJsonStructure(['error' => ['details' => ['pack_size']]]);
        $this->catalogRow($pran->id, $juice->id, ['pack_size' => '2.5'], 422)->assertJsonPath('error.details.pack_size.0', 'Mango Juice is bought in whole units (pcs).');
        $this->catalogRow($pran->id, $juice->id, ['min_order_qty' => '0'], 422)->assertJsonStructure(['error' => ['details' => ['min_order_qty']]]);
        $this->catalogRow($pran->id, $juice->id, ['lead_time_days' => 366], 422)->assertJsonStructure(['error' => ['details' => ['lead_time_days']]]);
        $this->catalogRow($pran->id, $juice->id, ['unit_cost' => '-1'], 422)->assertJsonStructure(['error' => ['details' => ['unit_cost']]]);
        $this->catalogRow($pran->id, $juice->id, ['last_purchase_cost' => '5'], 422)->assertJsonStructure(['error' => ['details' => ['last_purchase_cost']]]);
        $this->catalogRow($sleeping->id, $juice->id, [], 422)->assertJsonPath('error.details.supplier_id.0', 'The selected supplier is inactive.');
        $this->catalogRow($pran->id, $juice->id, ['is_preferred' => true, 'is_active' => false], 422)->assertJsonStructure(['error' => ['details' => ['is_preferred']]]);

        $this->catalogRow($pran->id, $juice->id);
        $this->catalogRow($pran->id, $juice->id, [], 422)->assertJsonPath('error.details.variant_id.0', 'This product is already in the supplier\'s catalog.');
    }

    public function test_one_preferred_supplier_per_variant(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $juice = $this->stockedVariant($org, 'Mango Juice');
        [$a, $b, $c] = [$this->supplier($org, 'A'), $this->supplier($org, 'B'), $this->supplier($org, 'C')];
        $this->actingAsUser($admin);

        $first = $this->catalogRow($a->id, $juice->id, ['is_preferred' => true])->json('data.id');
        $second = $this->catalogRow($b->id, $juice->id, ['is_preferred' => true])->json('data.id');
        $third = $this->catalogRow($c->id, $juice->id)->json('data.id');
        $preferred = fn () => collect($this->getJson("/api/v1/purchasing/supplier-products?variant_id={$juice->id}&is_preferred=1")->json('data'))->pluck('id')->all();
        $this->assertSame([$second], $preferred());

        $this->postJson("/api/v1/purchasing/supplier-products/{$third}/preferred")->assertOk()->assertJsonPath('data.is_preferred', true);
        $this->assertSame([$third], $preferred());

        $this->patchJson("/api/v1/purchasing/supplier-products/{$first}", ['is_preferred' => true])->assertOk();
        $this->assertSame([$first], $preferred());

        // Deactivating the preferred row unsets it; an inactive row cannot be preferred.
        $this->patchJson("/api/v1/purchasing/supplier-products/{$first}", ['is_active' => false])->assertOk()->assertJsonPath('data.is_preferred', false);
        $this->assertSame([], $preferred());
        $this->postJson("/api/v1/purchasing/supplier-products/{$first}/preferred")->assertStatus(422)->assertJsonPath('error.code', 'SUPPLIER_PRODUCT_INACTIVE');

        // An inactive supplier cannot be preferred.
        $this->inTenant($org, fn () => $b->forceFill(['is_active' => false])->save());
        $this->postJson("/api/v1/purchasing/supplier-products/{$second}/preferred")->assertStatus(422)->assertJsonPath('error.code', 'SUPPLIER_INACTIVE');

        // The database refuses a second preferred row for the variant.
        $this->inTenant($org, fn () => SupplierProduct::query()->whereKey($third)->update(['is_preferred' => true]));
        $this->expectException(UniqueConstraintViolationException::class);
        $this->inTenant($org, fn () => SupplierProduct::query()->whereKey($second)->update(['is_preferred' => true]));
    }

    public function test_lookup_prefills_purchase_order_lines(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $juice = $this->stockedVariant($org, 'Mango Juice');
        $water = $this->stockedVariant($org, 'Water');
        $soap = $this->stockedVariant($org, 'Soap');
        $pran = $this->supplier($org, 'Pran');
        $this->actingAsUser($admin);
        $this->catalogRow($pran->id, $juice->id, ['unit_cost' => '18', 'pack_size' => '24', 'min_order_qty' => '48', 'lead_time_days' => 2, 'supplier_sku' => 'J-1']);
        $this->catalogRow($pran->id, $water->id, ['is_active' => false]);

        $rows = $this->getJson('/api/v1/purchasing/supplier-products/lookup?'.http_build_query(['supplier_id' => $pran->id, 'variant_ids' => [$juice->id, $water->id, $soap->id]]))
            ->assertOk()->json('data');

        $this->assertCount(1, $rows); // inactive and missing rows are left out
        $this->assertSame([
            'variant_id' => $juice->id, 'supplier_sku' => 'J-1', 'unit_cost' => '18.0000', 'pack_size' => '24.000',
            'min_order_qty' => '48.000', 'lead_time_days' => 2, 'is_preferred' => false, 'last_purchase_cost' => null,
        ], array_diff_key($rows[0], ['supplier_product_id' => true]));
        $this->getJson('/api/v1/purchasing/supplier-products/lookup?supplier_id='.$pran->id)->assertStatus(422);
    }

    public function test_goods_receipts_record_the_last_purchase_cost(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $juice = $this->stockedVariant($org, 'Mango Juice');
        $pran = $this->supplier($org, 'Pran');
        $other = $this->supplier($org, 'Other');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $row = $this->catalogRow($pran->id, $juice->id, ['unit_cost' => '18'])->json('data.id');
        $otherRow = $this->catalogRow($other->id, $juice->id, ['unit_cost' => '17'])->json('data.id');

        $this->postJson('/api/v1/purchasing/receipts', [
            'supplier_id' => $pran->id, 'store_id' => $store, 'invoice_date' => now()->toDateString(),
            'lines' => [['variant_id' => $juice->id, 'quantity' => '24', 'unit_cost' => '18.75', 'tax_rate' => '0']],
        ])->assertCreated();

        $list = collect($this->getJson("/api/v1/purchasing/supplier-products?variant_id={$juice->id}")->json('data'))->keyBy('id');
        $this->assertSame('18.7500', $list[$row]['last_purchase_cost']);
        $this->assertNotNull($list[$row]['last_purchased_at']);
        $this->assertSame('18.0000', $list[$row]['unit_cost']); // the catalog cost stays as agreed
        $this->assertNull($list[$otherRow]['last_purchase_cost']);
    }

    public function test_permissions(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $juice = $this->stockedVariant($org, 'Mango Juice');
        $pran = $this->supplier($org, 'Pran');
        $this->actingAsUser($admin);
        $row = $this->catalogRow($pran->id, $juice->id)->json('data.id');
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $accountant = $this->createUserWithRole($org, SystemRole::Accountant, [$branch->id]);

        $this->actingAsUser($cashier)->getJson('/api/v1/purchasing/supplier-products')->assertForbidden();
        $this->actingAsUser($accountant)->getJson('/api/v1/purchasing/supplier-products')->assertOk();
        $this->getJson("/api/v1/purchasing/supplier-products/lookup?supplier_id={$pran->id}&variant_ids[]={$juice->id}")->assertOk();
        $this->catalogRow($pran->id, $juice->id, [], 403);
        $this->patchJson("/api/v1/purchasing/supplier-products/{$row}", ['unit_cost' => '1'])->assertForbidden();
        $this->postJson("/api/v1/purchasing/supplier-products/{$row}/preferred")->assertForbidden();
        $this->deleteJson("/api/v1/purchasing/supplier-products/{$row}")->assertForbidden();
    }

    public function test_tenant_isolation(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant('Acme');
        ['admin' => $rival, 'organization' => $rivalOrg] = $this->provisionTenant('Rival');
        $juice = $this->stockedVariant($org, 'Mango Juice');
        $pran = $this->supplier($org, 'Pran');
        $rivalJuice = $this->stockedVariant($rivalOrg, 'Rival Juice');
        $rivalSupplier = $this->supplier($rivalOrg, 'Rival Supplier');
        $this->actingAsUser($admin);
        $row = $this->catalogRow($pran->id, $juice->id)->json('data.id');

        $this->actingAsUser($rival);
        $this->getJson('/api/v1/purchasing/supplier-products')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson("/api/v1/purchasing/supplier-products/lookup?supplier_id={$pran->id}&variant_ids[]={$juice->id}")->assertOk()->assertJsonCount(0, 'data');
        $this->patchJson("/api/v1/purchasing/supplier-products/{$row}", ['unit_cost' => '1'])->assertNotFound();
        $this->postJson("/api/v1/purchasing/supplier-products/{$row}/preferred")->assertNotFound();
        $this->deleteJson("/api/v1/purchasing/supplier-products/{$row}")->assertNotFound();
        // Another organization's supplier or product cannot be catalogued.
        $this->catalogRow($pran->id, $rivalJuice->id, [], 422)->assertJsonStructure(['error' => ['details' => ['supplier_id']]]);
        $this->catalogRow($rivalSupplier->id, $juice->id, [], 422)->assertJsonPath('error.details.variant_id.0', 'This product does not exist.');
    }
}
