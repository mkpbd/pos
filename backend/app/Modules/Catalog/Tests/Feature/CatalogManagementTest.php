<?php

namespace App\Modules\Catalog\Tests\Feature;

use App\Modules\Catalog\Infrastructure\Models\Category;
use App\Modules\Catalog\Tests\Concerns\CreatesCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CatalogManagementTest extends TestCase
{
    use CreatesCatalog, InteractsWithTenancy, RefreshDatabase;

    public function test_admin_manages_brands_with_case_insensitive_uniqueness(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $id = $this->postJson('/api/v1/brands', ['name' => 'Pran'])->assertCreated()->assertJsonPath('data.is_active', true)->json('data.id');
        $this->postJson('/api/v1/brands', ['name' => ' PRAN '])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['name']]]);
        $this->patchJson("/api/v1/brands/{$id}", ['name' => 'Pran Foods', 'is_active' => false])->assertOk()->assertJsonPath('data.name', 'Pran Foods');

        $this->getJson('/api/v1/brands?active=1')->assertOk()->assertJsonCount(0, 'data');
        $this->assertDatabaseHas('audit_logs', ['organization_id' => $org->id, 'action' => 'brand.updated', 'subject_id' => $id]);

        $this->deleteJson("/api/v1/brands/{$id}")->assertNoContent();
        $this->assertDatabaseHas('audit_logs', ['action' => 'brand.deleted', 'subject_id' => $id]);
    }

    public function test_tax_rates_are_decimal_and_bounded(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $this->postJson('/api/v1/tax-rates', ['name' => 'VAT', 'rate' => '7.5'])->assertCreated()->assertJsonPath('data.rate', '7.5000');
        $this->postJson('/api/v1/tax-rates', ['name' => 'Bad', 'rate' => '101'])->assertStatus(422);
        $this->postJson('/api/v1/tax-rates', ['name' => 'Bad2', 'rate' => '1.123456'])->assertStatus(422);
    }

    public function test_units_support_one_level_of_conversion(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $pcs = $this->postJson('/api/v1/units', ['name' => 'Piece', 'code' => 'pcs'])->assertCreated()->json('data.id');
        $box = $this->postJson('/api/v1/units', ['name' => 'Box', 'code' => 'box', 'base_unit_id' => $pcs, 'conversion_factor' => '12'])
            ->assertCreated()->assertJsonPath('data.conversion_factor', '12.000000')->json('data.id');

        $this->postJson('/api/v1/units', ['name' => 'Carton', 'code' => 'ctn', 'base_unit_id' => $box, 'conversion_factor' => '10'])
            ->assertStatus(422)->assertJsonPath('error.code', 'INVALID_BASE_UNIT');
        $this->postJson('/api/v1/units', ['name' => 'Dozen', 'code' => 'dz', 'base_unit_id' => $pcs])
            ->assertStatus(422)->assertJsonPath('error.code', 'INVALID_CONVERSION_FACTOR');
        $this->patchJson("/api/v1/units/{$pcs}", ['base_unit_id' => $box, 'conversion_factor' => '1'])
            ->assertStatus(422)->assertJsonPath('error.code', 'INVALID_BASE_UNIT');

        // A base unit with derived units cannot be deleted.
        $this->deleteJson("/api/v1/units/{$pcs}")->assertStatus(422)->assertJsonPath('error.code', 'IN_USE');
    }

    public function test_category_tree_rejects_cycles_and_excess_depth(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $food = $this->postJson('/api/v1/categories', ['name' => 'Food'])->json('data.id');
        $snacks = $this->postJson('/api/v1/categories', ['name' => 'Snacks', 'parent_id' => $food])->json('data.id');
        $chips = $this->postJson('/api/v1/categories', ['name' => 'Chips', 'parent_id' => $snacks])->json('data.id');

        $this->patchJson("/api/v1/categories/{$food}", ['parent_id' => $chips])
            ->assertStatus(422)->assertJsonPath('error.code', 'CATEGORY_CYCLE');

        $level4 = $this->postJson('/api/v1/categories', ['name' => 'Potato', 'parent_id' => $chips])->assertCreated()->json('data.id');
        $this->postJson('/api/v1/categories', ['name' => 'Too deep', 'parent_id' => $level4])
            ->assertStatus(422)->assertJsonPath('error.code', 'CATEGORY_TOO_DEEP');

        // Same name allowed under different parents, not twice under the same parent.
        $this->postJson('/api/v1/categories', ['name' => 'Chips'])->assertCreated();
        $this->postJson('/api/v1/categories', ['name' => 'chips', 'parent_id' => $snacks])->assertStatus(422);

        // Parent with children cannot be deleted.
        $this->deleteJson("/api/v1/categories/{$snacks}")->assertStatus(422)->assertJsonPath('error.code', 'IN_USE');
        $this->assertNotNull(Category::query()->withoutGlobalScopes()->find($snacks));
    }

    public function test_cashier_reads_reference_data_but_cannot_change_it(): void
    {
        ['organization' => $org] = $this->provisionTenant();
        $this->createCatalog($org);
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);
        $this->actingAsUser($cashier);

        $this->getJson('/api/v1/units')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/v1/categories')->assertOk();
        $this->postJson('/api/v1/brands', ['name' => 'X'])->assertForbidden();
        $this->postJson('/api/v1/tax-rates', ['name' => 'X', 'rate' => '1'])->assertForbidden();
    }

    public function test_reference_data_is_isolated_per_organization(): void
    {
        ['admin' => $adminA] = $this->provisionTenant('Alpha');
        ['organization' => $orgB] = $this->provisionTenant('Beta');
        ['brand' => $brandB] = $this->createCatalog($orgB);
        $this->actingAsUser($adminA);

        $this->getJson('/api/v1/brands')->assertOk()->assertJsonCount(0, 'data');
        $this->patchJson("/api/v1/brands/{$brandB->id}", ['name' => 'Hijack'])->assertNotFound();
        $this->deleteJson("/api/v1/brands/{$brandB->id}")->assertNotFound();
        // Names are unique per organization only.
        $this->postJson('/api/v1/brands', ['name' => 'Pran'])->assertCreated();
    }
}
