<?php

namespace App\Modules\Branches\Tests\Feature;

use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BranchManagementTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    public function test_creating_a_branch_also_creates_its_main_store(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();

        $this->actingAsUser($admin)->postJson('/api/v1/branches', [
            'code' => 'ctg-1',
            'name' => 'Chattogram',
            'timezone' => 'Asia/Dhaka',
            'allow_negative_stock' => true,
        ])
            ->assertCreated()
            ->assertJsonPath('data.code', 'CTG-1')
            ->assertJsonPath('data.allow_negative_stock', true)
            ->assertJsonPath('data.is_active', true)
            ->assertJsonPath('data.stores.0.code', 'MAIN')
            ->assertJsonPath('data.stores.0.type', 'store');

        $this->assertDatabaseHas('audit_logs', ['organization_id' => $org->id, 'action' => 'branch.created']);
    }

    public function test_branch_codes_are_unique_per_organization_only(): void
    {
        ['admin' => $adminA] = $this->provisionTenant('Alpha');
        ['admin' => $adminB] = $this->provisionTenant('Beta');

        $this->actingAsUser($adminA)->postJson('/api/v1/branches', ['code' => 'MAIN', 'name' => 'Dup'])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['code']]]);
        $this->actingAsUser($adminA)->postJson('/api/v1/branches', ['code' => 'NORTH', 'name' => 'North'])->assertCreated();
        $this->actingAsUser($adminB)->postJson('/api/v1/branches', ['code' => 'north', 'name' => 'North'])->assertCreated();
    }

    public function test_invalid_input_is_rejected(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $this->postJson('/api/v1/branches', ['code' => 'bad code!', 'name' => 'X', 'timezone' => 'Mars/Base'])
            ->assertStatus(422)
            ->assertJsonStructure(['error' => ['details' => ['code', 'timezone']]]);
        $this->postJson('/api/v1/branches', ['code' => 'OK', 'name' => 'X', 'is_active' => false])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['is_active']]]);
    }

    public function test_update_and_deactivate_with_last_active_branch_guard(): void
    {
        ['admin' => $admin, 'branch' => $main, 'organization' => $org] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $this->patchJson("/api/v1/branches/{$main->id}", ['is_active' => false])
            ->assertStatus(422)->assertJsonPath('error.code', 'LAST_ACTIVE_BRANCH');

        $north = $this->createBranch($org, 'NORTH');
        $this->patchJson("/api/v1/branches/{$main->id}", ['is_active' => false, 'phone' => '+8801700000000'])
            ->assertOk()->assertJsonPath('data.is_active', false)->assertJsonPath('data.phone', '+8801700000000');

        $this->getJson('/api/v1/branches?is_active=1')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $north->id);
        $this->assertDatabaseHas('audit_logs', ['action' => 'branch.updated', 'subject_id' => $main->id]);
    }

    public function test_stores_crud_within_a_branch(): void
    {
        ['admin' => $admin, 'branch' => $main] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $storeId = $this->postJson("/api/v1/branches/{$main->id}/stores", ['code' => 'wh1', 'name' => 'Warehouse', 'type' => 'warehouse'])
            ->assertCreated()->assertJsonPath('data.code', 'WH1')->assertJsonPath('data.type', 'warehouse')->json('data.id');

        $this->postJson("/api/v1/branches/{$main->id}/stores", ['code' => 'WH1', 'name' => 'Dup', 'type' => 'store'])
            ->assertStatus(422);

        $this->patchJson("/api/v1/branches/{$main->id}/stores/{$storeId}", ['name' => 'Central Warehouse', 'is_active' => false])
            ->assertOk()->assertJsonPath('data.name', 'Central Warehouse')->assertJsonPath('data.is_active', false);

        $this->getJson("/api/v1/branches/{$main->id}/stores")->assertOk()->assertJsonCount(2, 'data');
    }

    public function test_store_must_belong_to_the_branch_in_the_url(): void
    {
        ['admin' => $admin, 'branch' => $main, 'organization' => $org] = $this->provisionTenant();
        $north = $this->createBranch($org, 'NORTH');
        $northStore = $north->stores()->firstOrFail();

        $this->actingAsUser($admin)
            ->patchJson("/api/v1/branches/{$main->id}/stores/{$northStore->id}", ['name' => 'Moved'])
            ->assertNotFound();
    }

    public function test_cashier_can_view_but_not_manage_branches(): void
    {
        ['organization' => $org, 'branch' => $main] = $this->provisionTenant();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$main->id]);

        $this->actingAsUser($cashier)->getJson('/api/v1/branches')->assertOk()->assertJsonCount(1, 'data');
        $this->actingAsUser($cashier)->postJson('/api/v1/branches', ['code' => 'X', 'name' => 'X'])->assertForbidden();
        $this->actingAsUser($cashier)->patchJson("/api/v1/branches/{$main->id}", ['name' => 'X'])->assertForbidden();
    }
}
