<?php

namespace App\Modules\Customers\Tests\Feature;

use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CustomerManagementTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    public function test_cashier_registers_customer_at_the_till_with_normalised_phone(): void
    {
        ['organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $this->actingAsUser($cashier);

        $this->postJson('/api/v1/customers', ['name' => 'Rina Akter', 'phone' => '+880 1711-000 000'])
            ->assertCreated()
            ->assertJsonPath('data.code', 'CUS-000001')
            ->assertJsonPath('data.phone', '+8801711000000')
            ->assertJsonPath('data.credit_limit', '0.00');

        // Lookup by phone ignores formatting.
        $this->getJson('/api/v1/customers?search='.urlencode('01711-000'))->assertOk()->assertJsonCount(1, 'data');
        $this->postJson('/api/v1/customers', ['name' => 'Someone else', 'phone' => '+8801711000000'])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['phone']]]);
    }

    public function test_cashier_cannot_set_commercial_terms_or_edit(): void
    {
        ['organization' => $org] = $this->provisionTenant();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);
        $this->actingAsUser($cashier);

        $this->postJson('/api/v1/customers', ['name' => 'Greedy', 'credit_limit' => '100000'])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['credit_limit']]]);
        $id = $this->postJson('/api/v1/customers', ['name' => 'Fine'])->assertCreated()->json('data.id');
        $this->patchJson("/api/v1/customers/{$id}", ['name' => 'Changed'])->assertForbidden();
    }

    public function test_manager_sets_group_and_credit_limit(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $group = $this->postJson('/api/v1/customer-groups', ['name' => 'Wholesale', 'discount_percent' => '5'])
            ->assertCreated()->assertJsonPath('data.discount_percent', '5.00')->json('data.id');
        $this->postJson('/api/v1/customer-groups', ['name' => 'wholesale'])->assertStatus(422);
        $this->postJson('/api/v1/customer-groups', ['name' => 'Silly', 'discount_percent' => '120'])->assertStatus(422);

        $id = $this->postJson('/api/v1/customers', ['name' => 'Rahman Traders', 'customer_group_id' => $group, 'credit_limit' => '50000', 'opening_balance' => '1200'])
            ->assertCreated()
            ->assertJsonPath('data.group.name', 'Wholesale')
            ->assertJsonPath('data.credit_limit', '50000.00')
            ->json('data.id');

        $this->patchJson("/api/v1/customers/{$id}", ['credit_limit' => '75000'])->assertOk()->assertJsonPath('data.credit_limit', '75000.00');
        $audit = $this->getJson('/api/v1/audit-logs?action=customer.updated')->json('data.0');
        $this->assertSame(['credit_limit' => '50000.00'], $audit['old_values']);

        $this->getJson("/api/v1/customers?customer_group_id={$group}")->assertJsonCount(1, 'data');
        $this->deleteJson("/api/v1/customer-groups/{$group}")->assertStatus(422)->assertJsonPath('error.code', 'IN_USE');
        $this->getJson('/api/v1/customer-groups')->assertJsonPath('data.0.customers_count', 1);
    }

    public function test_archiving_frees_the_phone_and_restore_detects_conflicts(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $old = $this->postJson('/api/v1/customers', ['name' => 'Old', 'phone' => '01800000000'])->json('data.id');

        $this->deleteJson("/api/v1/customers/{$old}")->assertNoContent();
        $this->postJson('/api/v1/customers', ['name' => 'New owner', 'phone' => '01800000000'])->assertCreated();

        $this->postJson("/api/v1/customers/{$old}/restore")->assertStatus(422)->assertJsonPath('error.code', 'PHONE_IN_USE');
    }

    public function test_customers_are_isolated_per_organization(): void
    {
        ['admin' => $adminA] = $this->provisionTenant('Alpha');
        ['admin' => $adminB] = $this->provisionTenant('Beta');
        $customerB = $this->actingAsUser($adminB)->postJson('/api/v1/customers', ['name' => 'B', 'phone' => '01900000000'])->json('data.id');
        $groupB = $this->postJson('/api/v1/customer-groups', ['name' => 'VIP'])->json('data.id');

        $this->actingAsUser($adminA);
        $this->getJson("/api/v1/customers/{$customerB}")->assertNotFound();
        $this->postJson('/api/v1/customers', ['name' => 'A', 'customer_group_id' => $groupB])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['customer_group_id']]]);
        // Same phone allowed in another organization; codes restart per organization.
        $this->postJson('/api/v1/customers', ['name' => 'A', 'phone' => '01900000000'])->assertCreated()->assertJsonPath('data.code', 'CUS-000001');
    }
}
