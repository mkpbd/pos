<?php

namespace App\Modules\Suppliers\Tests\Feature;

use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SupplierManagementTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    public function test_create_with_generated_code_update_and_search(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $first = $this->postJson('/api/v1/suppliers', ['name' => 'Pran Distribution', 'phone' => '01700000000', 'payment_terms_days' => 30, 'opening_balance' => '1500.50'])
            ->assertCreated()
            ->assertJsonPath('data.code', 'SUP-0001')
            ->assertJsonPath('data.opening_balance', '1500.50')
            ->json('data.id');
        $this->postJson('/api/v1/suppliers', ['name' => 'ACI Ltd'])->assertCreated()->assertJsonPath('data.code', 'SUP-0002');
        $this->postJson('/api/v1/suppliers', ['name' => 'Custom', 'code' => 'acme-1'])->assertCreated()->assertJsonPath('data.code', 'ACME-1');
        $this->postJson('/api/v1/suppliers', ['name' => 'Dup', 'code' => 'Acme-1'])->assertStatus(422);

        $this->patchJson("/api/v1/suppliers/{$first}", ['contact_person' => 'Karim'])->assertOk()->assertJsonPath('data.contact_person', 'Karim');
        $this->getJson('/api/v1/suppliers?search=pran')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/v1/suppliers?search=0170')->assertOk()->assertJsonCount(1, 'data');
        $this->assertDatabaseHas('audit_logs', ['organization_id' => $org->id, 'action' => 'supplier.updated', 'subject_id' => $first]);
    }

    public function test_archive_frees_code_and_restore(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $id = $this->postJson('/api/v1/suppliers', ['name' => 'Old Co', 'code' => 'OLD'])->json('data.id');

        $this->deleteJson("/api/v1/suppliers/{$id}")->assertNoContent();
        $this->getJson('/api/v1/suppliers')->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/suppliers?archived=1')->assertJsonCount(1, 'data');

        $this->postJson("/api/v1/suppliers/{$id}/restore")->assertOk()->assertJsonPath('data.archived_at', null);
    }

    public function test_permissions_and_isolation(): void
    {
        ['organization' => $orgA] = $this->provisionTenant('Alpha');
        ['admin' => $adminB] = $this->provisionTenant('Beta');
        $supplierB = $this->actingAsUser($adminB)->postJson('/api/v1/suppliers', ['name' => 'Beta supplier'])->json('data.id');

        $cashier = $this->createUserWithRole($orgA, SystemRole::Cashier);
        $inventory = $this->createUserWithRole($orgA, SystemRole::InventoryManager);

        $this->actingAsUser($cashier)->getJson('/api/v1/suppliers')->assertForbidden();
        $this->actingAsUser($inventory)->postJson('/api/v1/suppliers', ['name' => 'Alpha supplier'])->assertCreated();
        $this->actingAsUser($inventory)->getJson("/api/v1/suppliers/{$supplierB}")->assertNotFound();
        $this->actingAsUser($inventory)->getJson('/api/v1/suppliers')->assertJsonCount(1, 'data');
    }
}
