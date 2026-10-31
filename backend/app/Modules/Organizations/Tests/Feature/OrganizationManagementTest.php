<?php

namespace App\Modules\Organizations\Tests\Feature;

use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class OrganizationManagementTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    public function test_admin_updates_profile_and_settings_with_audit_trail(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();

        $this->actingAsUser($admin)
            ->patchJson('/api/v1/organization', [
                'legal_name' => 'Acme Retail Ltd.',
                'tax_mode' => 'inclusive',
                'settings' => ['receipt_footer' => 'Thank you!', 'invoice_prefix' => 'ACM'],
            ])
            ->assertOk()
            ->assertJsonPath('data.legal_name', 'Acme Retail Ltd.')
            ->assertJsonPath('data.tax_mode', 'inclusive')
            ->assertJsonPath('data.settings.receipt_footer', 'Thank you!');

        $this->assertDatabaseHas('audit_logs', ['organization_id' => $org->id, 'action' => 'organization.updated', 'user_id' => $admin->id]);
    }

    public function test_base_currency_and_unknown_settings_are_rejected(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $this->patchJson('/api/v1/organization', ['base_currency' => 'USD'])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['base_currency']]]);
        $this->patchJson('/api/v1/organization', ['settings' => ['evil' => true]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['settings']]]);
    }

    public function test_cashier_can_not_edit_organization(): void
    {
        ['organization' => $org] = $this->provisionTenant();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);

        $this->actingAsUser($cashier)
            ->patchJson('/api/v1/organization', ['name' => 'Mine now'])
            ->assertForbidden()
            ->assertJsonPath('error.code', 'FORBIDDEN');
    }

    public function test_platform_admin_lists_provisions_and_suspends_organizations(): void
    {
        ['admin' => $tenantAdmin, 'organization' => $org] = $this->provisionTenant('Alpha');
        $platform = User::factory()->platformAdmin()->create();

        $this->actingAsUser($platform);

        $this->getJson('/api/v1/platform/organizations')->assertOk()->assertJsonPath('meta.pagination.total', 1);

        $this->postJson('/api/v1/platform/organizations', [
            'organization_name' => 'Gamma Stores',
            'name' => 'Gamma Owner',
            'email' => 'owner@gamma.test',
            'password' => 'password1',
            'password_confirmation' => 'password1',
            'currency' => 'usd',
        ])->assertCreated()->assertJsonPath('data.base_currency', 'USD');

        $this->patchJson("/api/v1/platform/organizations/{$org->id}/status", ['status' => 'suspended'])
            ->assertOk()->assertJsonPath('data.status', 'suspended');
        $this->assertDatabaseHas('audit_logs', ['organization_id' => $org->id, 'action' => 'organization.suspended']);

        $this->actingAsUser($tenantAdmin)
            ->getJson('/api/v1/users')
            ->assertForbidden()
            ->assertJsonPath('error.code', 'ORGANIZATION_SUSPENDED');
    }

    public function test_platform_admin_can_act_inside_a_chosen_organization(): void
    {
        ['admin' => $tenantAdmin, 'organization' => $org] = $this->provisionTenant('Alpha');
        $this->provisionTenant('Beta');
        $platform = User::factory()->platformAdmin()->create();

        $this->actingAsUser($platform);

        $this->getJson('/api/v1/users')->assertStatus(400)->assertJsonPath('error.code', 'ORGANIZATION_CONTEXT_REQUIRED');
        $this->withHeader('X-Organization-Id', $org->id)->getJson('/api/v1/users')
            ->assertOk()
            ->assertJsonPath('data.0.id', $tenantAdmin->id)
            ->assertJsonCount(1, 'data');
    }

    public function test_tenant_admins_cannot_use_platform_routes_or_switch_organization(): void
    {
        ['admin' => $adminA] = $this->provisionTenant('Alpha');
        ['organization' => $orgB] = $this->provisionTenant('Beta');

        $this->actingAsUser($adminA);

        $this->getJson('/api/v1/platform/organizations')->assertForbidden();
        // The header is ignored for tenant users: they always stay in their own organization.
        $ids = $this->withHeader('X-Organization-Id', $orgB->id)->getJson('/api/v1/users')->assertOk()->json('data.*.id');
        $this->assertSame([$adminA->id], $ids);
    }
}
