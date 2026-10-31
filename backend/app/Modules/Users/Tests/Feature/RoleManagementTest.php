<?php

namespace App\Modules\Users\Tests\Feature;

use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RoleManagementTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    public function test_permission_catalog_is_grouped_by_module(): void
    {
        ['admin' => $admin] = $this->provisionTenant();

        $modules = $this->actingAsUser($admin)->getJson('/api/v1/permissions')->assertOk()->json('data.*.module');

        $this->assertSame($modules, array_values(array_unique($modules)), 'each module appears once');
        foreach (['Audit', 'Branches', 'Organizations', 'Users', 'Products', 'Customers'] as $module) {
            $this->assertContains($module, $modules);
        }
    }

    public function test_built_in_roles_have_expected_permissions(): void
    {
        ['admin' => $admin] = $this->provisionTenant();

        $roles = collect($this->actingAsUser($admin)->getJson('/api/v1/roles')->assertOk()->json('data'))->keyBy('system_key');

        $this->assertContains('roles.manage', $roles['organization_admin']['permissions']);
        $this->assertContains('branches.access_all', $roles['organization_admin']['permissions']);
        $this->assertNotContains('users.manage', $roles['branch_manager']['permissions']);
        $this->assertContains('users.view', $roles['branch_manager']['permissions']);
        $this->assertContains('products.view', $roles['cashier']['permissions']);
        $this->assertContains('customers.create', $roles['cashier']['permissions']);
        $this->assertEmpty(array_filter($roles['cashier']['permissions'], fn (string $p) => str_ends_with($p, '.manage') || $p === 'products.view_cost'));
        $this->assertContains('audit.view', $roles['accountant']['permissions']);
        $this->assertSame(1, $roles['organization_admin']['users_count']);
    }

    public function test_custom_role_grants_exactly_its_permissions(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();

        $roleId = $this->actingAsUser($admin)->postJson('/api/v1/roles', [
            'name' => 'Auditor',
            'description' => 'Reads the audit trail',
            'permissions' => ['audit.view'],
        ])->assertCreated()->assertJsonPath('data.is_system', false)->json('data.id');

        $auditor = $this->createUserWithRole($org, Role::query()->withoutGlobalScopes()->findOrFail($roleId));

        $this->actingAsUser($auditor)->getJson('/api/v1/audit-logs')->assertOk();
        $this->actingAsUser($auditor)->getJson('/api/v1/users')->assertForbidden();
    }

    public function test_role_update_takes_effect_and_is_audited(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $roleId = $this->postJson('/api/v1/roles', ['name' => 'Viewer', 'permissions' => ['users.view']])->json('data.id');

        $this->putJson("/api/v1/roles/{$roleId}", ['name' => 'Viewer+', 'permissions' => ['users.view', 'branches.view']])
            ->assertOk()
            ->assertJsonPath('data.name', 'Viewer+')
            ->assertJsonPath('data.permissions', ['branches.view', 'users.view']);

        $this->assertDatabaseHas('audit_logs', ['organization_id' => $org->id, 'action' => 'role.updated', 'subject_id' => $roleId]);
    }

    public function test_unknown_permissions_and_duplicate_names_are_rejected(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $this->postJson('/api/v1/roles', ['name' => 'X', 'permissions' => ['root.everything']])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['permissions.0']]]);
        $this->postJson('/api/v1/roles', ['name' => 'Cashier', 'permissions' => []])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['name']]]);
    }

    public function test_same_role_name_is_allowed_in_another_organization(): void
    {
        ['admin' => $adminA] = $this->provisionTenant('Alpha');
        ['admin' => $adminB] = $this->provisionTenant('Beta');

        $this->actingAsUser($adminA)->postJson('/api/v1/roles', ['name' => 'Night shift', 'permissions' => []])->assertCreated();
        $this->actingAsUser($adminB)->postJson('/api/v1/roles', ['name' => 'Night shift', 'permissions' => []])->assertCreated();
    }

    public function test_role_managers_cannot_grant_permissions_they_lack(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $roleAdminId = $this->actingAsUser($admin)
            ->postJson('/api/v1/roles', ['name' => 'Role admin', 'permissions' => ['roles.view', 'roles.manage']])
            ->json('data.id');
        $powerfulId = $this->postJson('/api/v1/roles', ['name' => 'Powerful', 'permissions' => ['users.manage']])->json('data.id');
        $roleAdmin = $this->createUserWithRole($org, Role::query()->withoutGlobalScopes()->findOrFail($roleAdminId));

        $this->actingAsUser($roleAdmin);

        $this->postJson('/api/v1/roles', ['name' => 'Sneaky', 'permissions' => ['users.manage']])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'PRIVILEGE_ESCALATION')
            ->assertJsonPath('error.details.permissions', ['users.manage']);
        // Nor rewrite a role that already holds permissions they lack.
        $this->putJson("/api/v1/roles/{$powerfulId}", ['name' => 'Powerful', 'permissions' => []])
            ->assertStatus(422)->assertJsonPath('error.code', 'PRIVILEGE_ESCALATION');
        $this->postJson('/api/v1/roles', ['name' => 'Viewer', 'permissions' => ['roles.view']])->assertCreated();
    }

    public function test_system_roles_are_read_only(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $cashier = $this->inTenant($org, fn () => Role::query()->where('system_key', SystemRole::Cashier->value)->firstOrFail());
        $this->actingAsUser($admin);

        $this->putJson("/api/v1/roles/{$cashier->id}", ['name' => 'Till', 'permissions' => ['users.manage']])
            ->assertStatus(422)->assertJsonPath('error.code', 'SYSTEM_ROLE_READ_ONLY');
        $this->deleteJson("/api/v1/roles/{$cashier->id}")
            ->assertStatus(422)->assertJsonPath('error.code', 'SYSTEM_ROLE_READ_ONLY');
    }

    public function test_role_in_use_cannot_be_deleted(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $roleId = $this->postJson('/api/v1/roles', ['name' => 'Temp', 'permissions' => []])->json('data.id');
        $this->createUserWithRole($org, Role::query()->withoutGlobalScopes()->findOrFail($roleId));

        $this->actingAsUser($admin)->deleteJson("/api/v1/roles/{$roleId}")
            ->assertStatus(422)->assertJsonPath('error.code', 'ROLE_IN_USE')->assertJsonPath('error.details.users', 1);

        $unused = $this->postJson('/api/v1/roles', ['name' => 'Unused', 'permissions' => []])->json('data.id');
        $this->deleteJson("/api/v1/roles/{$unused}")->assertNoContent();
        $this->assertDatabaseMissing('roles', ['id' => $unused]);
    }

    public function test_permission_sync_command_refreshes_built_in_roles(): void
    {
        ['organization' => $org] = $this->provisionTenant();
        $adminRole = $this->inTenant($org, fn () => Role::query()->where('system_key', 'organization_admin')->firstOrFail());
        $adminRole->permissions()->sync([]);

        $this->artisan('pos:permissions:sync')->assertSuccessful();

        $this->assertContains('users.manage', $adminRole->permissions()->pluck('name')->all());
    }
}
