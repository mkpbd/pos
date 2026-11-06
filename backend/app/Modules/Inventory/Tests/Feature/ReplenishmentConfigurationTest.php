<?php

namespace App\Modules\Inventory\Tests\Feature;

use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * SC1: per-store reorder rules and the organization's replenishment settings.
 */
class ReplenishmentConfigurationTest extends TestCase
{
    use InteractsWithStock, InteractsWithTenancy, RefreshDatabase;

    public function test_reorder_rules_bulk_upsert_list_and_delete(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $juice = $this->stockedVariant($org, 'Mango Juice');
        $rice = $this->stockedVariant($org, 'Miniket Rice', decimalUnit: true);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);

        $saved = $this->putJson('/api/v1/inventory/reorder-rules', ['store_id' => $store, 'rules' => [
            ['variant_id' => $rice->id, 'min_qty' => '50.5', 'max_qty' => '200'],
            ['variant_id' => $juice->id, 'min_qty' => '24'],
        ]])->assertOk()->json('data');
        $this->assertCount(2, $saved);
        $this->assertSame('50.500', $saved[0]['min_qty']);
        $this->assertSame('200.000', $saved[0]['max_qty']);
        $this->assertSame('Main Store', $saved[0]['store']['name']);
        $this->assertSame('Miniket Rice', $saved[0]['variant']['product_name']);
        $this->assertNull($saved[1]['max_qty']);
        $this->assertTrue($saved[1]['is_active']);

        // Upsert by store × variant: the same rows are updated, not duplicated.
        $updated = $this->putJson('/api/v1/inventory/reorder-rules', ['store_id' => $store, 'rules' => [
            ['variant_id' => $juice->id, 'min_qty' => '48', 'max_qty' => '96', 'is_active' => false],
        ]])->assertOk()->json('data.0');
        $this->assertSame($saved[1]['id'], $updated['id']);
        $this->assertFalse($updated['is_active']);

        $this->getJson("/api/v1/inventory/reorder-rules?store_id={$store}")->assertOk()
            ->assertJsonPath('meta.pagination.total', 2)
            ->assertJsonPath('data.0.variant.product_name', 'Mango Juice')
            ->assertJsonPath('data.0.min_qty', '48.000');
        $this->getJson("/api/v1/inventory/reorder-rules?variant_id={$rice->id}")->assertJsonCount(1, 'data');
        $this->getJson('/api/v1/inventory/reorder-rules?is_active=1')->assertJsonCount(1, 'data');
        $this->getJson('/api/v1/inventory/reorder-rules?search=mango')->assertJsonCount(1, 'data');

        $this->deleteJson("/api/v1/inventory/reorder-rules/{$updated['id']}")->assertNoContent();
        $this->getJson('/api/v1/inventory/reorder-rules')->assertJsonPath('meta.pagination.total', 1);
    }

    public function test_reorder_rule_validation(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $juice = $this->stockedVariant($org, 'Mango Juice');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $put = fn (array $rules) => $this->putJson('/api/v1/inventory/reorder-rules', ['store_id' => $store, 'rules' => $rules]);

        $put([['variant_id' => $juice->id, 'min_qty' => '10', 'max_qty' => '5']])->assertStatus(422)->assertJsonPath('error.details', ['rules.0.max_qty' => ['The maximum must be at least the minimum.']]);
        $put([['variant_id' => $juice->id, 'min_qty' => '1.5']])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['rules.0.min_qty']]]);
        $put([['variant_id' => $juice->id, 'min_qty' => '-1']])->assertStatus(422);
        $put([['variant_id' => $juice->id, 'min_qty' => '1'], ['variant_id' => $juice->id, 'min_qty' => '2']])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['rules.1.variant_id']]]);
        $this->assertSame(['This product does not exist.'], $put([['variant_id' => '00000000-0000-4000-8000-000000000000', 'min_qty' => '1']])->assertStatus(422)->json('error.details')['rules.0.variant_id']);
        $put(array_fill(0, 501, ['variant_id' => $juice->id, 'min_qty' => '1']))->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['rules']]]);
        $this->putJson('/api/v1/inventory/reorder-rules', ['store_id' => '00000000-0000-4000-8000-000000000000', 'rules' => [['variant_id' => $juice->id, 'min_qty' => '1']]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['store_id']]]);
    }

    public function test_reorder_rules_are_scoped_to_branches_and_organizations(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $main] = $this->provisionTenant('Acme');
        ['admin' => $rival] = $this->provisionTenant('Rival');
        $juice = $this->stockedVariant($org, 'Mango Juice');
        $store = $this->mainStoreId($org);
        $north = $this->createBranch($org, 'NORTH');
        $northClerk = $this->createUserWithRole($org, SystemRole::InventoryManager, [$north->id]);
        $this->actingAsUser($admin);
        $rule = $this->putJson('/api/v1/inventory/reorder-rules', ['store_id' => $store, 'rules' => [['variant_id' => $juice->id, 'min_qty' => '5']]])->json('data.0.id');

        $this->actingAsUser($northClerk);
        $this->getJson('/api/v1/inventory/reorder-rules')->assertOk()->assertJsonCount(0, 'data');
        $this->putJson('/api/v1/inventory/reorder-rules', ['store_id' => $store, 'rules' => [['variant_id' => $juice->id, 'min_qty' => '1']]])
            ->assertStatus(422)->assertJsonPath('error.details.store_id.0', 'The selected store does not exist.');
        $this->deleteJson("/api/v1/inventory/reorder-rules/{$rule}")->assertNotFound();

        $this->actingAsUser($rival);
        $this->getJson('/api/v1/inventory/reorder-rules')->assertOk()->assertJsonCount(0, 'data');
        $this->putJson('/api/v1/inventory/reorder-rules', ['store_id' => $store, 'rules' => [['variant_id' => $juice->id, 'min_qty' => '1']]])->assertStatus(422);
        $this->deleteJson("/api/v1/inventory/reorder-rules/{$rule}")->assertNotFound();
    }

    public function test_reorder_rule_permissions(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $juice = $this->stockedVariant($org, 'Mango Juice');
        $store = $this->mainStoreId($org);
        $online = $this->createUserWithRole($org, SystemRole::OnlineStoreManager, [$branch->id]); // inventory.view only
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $stock = $this->createUserWithRole($org, SystemRole::InventoryManager, [$branch->id]);
        $rule = ['store_id' => $store, 'rules' => [['variant_id' => $juice->id, 'min_qty' => '5']]];

        $this->actingAsUser($cashier)->getJson('/api/v1/inventory/reorder-rules')->assertForbidden();
        $this->actingAsUser($online)->getJson('/api/v1/inventory/reorder-rules')->assertOk();
        $this->putJson('/api/v1/inventory/reorder-rules', $rule)->assertForbidden();
        $this->patchJson('/api/v1/inventory/replenishment-settings', ['coverage_days' => 20])->assertForbidden();
        $id = $this->actingAsUser($stock)->putJson('/api/v1/inventory/reorder-rules', $rule)->assertOk()->json('data.0.id');
        $this->actingAsUser($online)->deleteJson("/api/v1/inventory/reorder-rules/{$id}")->assertForbidden();
        $this->actingAsUser($admin)->deleteJson("/api/v1/inventory/reorder-rules/{$id}")->assertNoContent();
    }

    public function test_replenishment_settings(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant('Acme');
        ['organization' => $rivalOrg] = $this->provisionTenant('Rival');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);

        $this->assertSame([
            'source_store' => null, 'source_store_id' => null, 'coverage_days' => 14, 'velocity_days' => 30, 'safety_days' => 3,
        ], $this->getJson('/api/v1/inventory/replenishment-settings')->assertOk()->json('data'));

        $this->patchJson('/api/v1/inventory/replenishment-settings', ['source_store_id' => $store, 'coverage_days' => 21, 'safety_days' => 0])->assertOk()
            ->assertJsonPath('data.source_store_id', $store)
            ->assertJsonPath('data.source_store.name', 'Main Store')
            ->assertJsonPath('data.coverage_days', 21)
            ->assertJsonPath('data.velocity_days', 30)
            ->assertJsonPath('data.safety_days', 0);
        $this->patchJson('/api/v1/inventory/replenishment-settings', ['velocity_days' => 60])->assertOk()
            ->assertJsonPath('data.source_store_id', $store)
            ->assertJsonPath('data.coverage_days', 21)
            ->assertJsonPath('data.velocity_days', 60);
        $this->patchJson('/api/v1/inventory/replenishment-settings', ['source_store_id' => null])->assertOk()->assertJsonPath('data.source_store', null);

        foreach ([['coverage_days' => 0], ['coverage_days' => 181], ['velocity_days' => 6], ['velocity_days' => 181], ['safety_days' => -1], ['safety_days' => 61]] as $invalid) {
            $this->patchJson('/api/v1/inventory/replenishment-settings', $invalid)->assertStatus(422)->assertJsonStructure(['error' => ['details' => [array_key_first($invalid)]]]);
        }
        $this->patchJson('/api/v1/inventory/replenishment-settings', ['source_store_id' => $this->mainStoreId($rivalOrg)])
            ->assertStatus(422)->assertJsonPath('error.details.source_store_id.0', 'The selected store does not exist.');
    }
}
