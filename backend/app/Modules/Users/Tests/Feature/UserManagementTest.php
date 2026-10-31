<?php

namespace App\Modules\Users\Tests\Feature;

use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserManagementTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    /**
     * Built-in role id. Each test provisions a single organization.
     */
    private function roleId(SystemRole $role): string
    {
        return Role::query()->withoutGlobalScopes()->where('system_key', $role->value)->sole()->id;
    }

    public function test_admin_creates_a_cashier_assigned_to_a_branch(): void
    {
        ['admin' => $admin, 'branch' => $branch, 'organization' => $org] = $this->provisionTenant();

        $response = $this->actingAsUser($admin)->postJson('/api/v1/users', [
            'name' => 'Karim',
            'email' => 'KARIM@acme.test',
            'password' => 'password1',
            'role_ids' => [$this->roleId(SystemRole::Cashier)],
            'branch_ids' => [$branch->id],
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.email', 'karim@acme.test')
            ->assertJsonPath('data.status', 'active')
            ->assertJsonPath('data.roles.0.system_key', 'cashier')
            ->assertJsonPath('data.branch_ids.0', $branch->id)
            ->assertJsonMissingPath('data.password');

        $this->assertDatabaseHas('users', ['email' => 'karim@acme.test', 'organization_id' => $org->id, 'created_by' => $admin->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'user.created', 'user_id' => $admin->id]);
    }

    public function test_is_platform_admin_cannot_be_mass_assigned(): void
    {
        ['admin' => $admin, 'branch' => $branch] = $this->provisionTenant();

        $this->actingAsUser($admin)->postJson('/api/v1/users', [
            'name' => 'Sneaky', 'email' => 'sneaky@acme.test', 'password' => 'password1',
            'role_ids' => [$this->roleId(SystemRole::Cashier)], 'branch_ids' => [$branch->id],
            'is_platform_admin' => true, 'organization_id' => null,
        ])->assertCreated()->assertJsonPath('data.is_platform_admin', false);
    }

    public function test_list_filters_and_search(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $this->createUserWithRole($org, SystemRole::Accountant);

        $this->actingAsUser($admin);

        $this->getJson('/api/v1/users?role_id='.$this->roleId(SystemRole::Cashier))
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $cashier->id);
        $this->getJson('/api/v1/users?search='.urlencode(substr($cashier->email, 0, 6)))
            ->assertOk()->assertJsonPath('data.0.id', $cashier->id);
        $this->getJson('/api/v1/users?per_page=2')->assertOk()
            ->assertJsonCount(2, 'data')->assertJsonPath('meta.pagination.total', 3)->assertJsonPath('meta.pagination.last_page', 2);
        $this->getJson('/api/v1/users?sort=password')->assertStatus(422);
    }

    public function test_permissions_are_enforced_per_route(): void
    {
        ['organization' => $org] = $this->provisionTenant();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);
        $manager = $this->createUserWithRole($org, SystemRole::BranchManager);

        $this->actingAsUser($cashier)->getJson('/api/v1/users')->assertForbidden();
        $this->actingAsUser($manager)->getJson('/api/v1/users')->assertOk();
        $this->actingAsUser($manager)->postJson('/api/v1/users', [])->assertForbidden();
    }

    public function test_admin_cannot_change_own_roles_or_status(): void
    {
        ['admin' => $admin] = $this->provisionTenant();

        $this->actingAsUser($admin)
            ->patchJson("/api/v1/users/{$admin->id}", ['status' => 'inactive'])
            ->assertStatus(422)->assertJsonPath('error.code', 'CANNOT_MODIFY_OWN_ACCESS');

        $this->actingAsUser($admin)
            ->patchJson("/api/v1/users/{$admin->id}", ['name' => 'Renamed'])
            ->assertOk()->assertJsonPath('data.name', 'Renamed');
    }

    public function test_organization_always_keeps_one_active_admin(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $second = $this->createUserWithRole($org, SystemRole::OrganizationAdmin);

        // With two admins, one may deactivate the other.
        $this->actingAsUser($second)->patchJson("/api/v1/users/{$admin->id}", ['status' => 'inactive'])->assertOk();

        // Only a platform admin can still reach the last admin; even they cannot remove it.
        $platform = User::factory()->platformAdmin()->create();
        $this->actingAsUser($platform)->withHeader('X-Organization-Id', $org->id);

        $this->patchJson("/api/v1/users/{$second->id}", ['role_ids' => [$this->roleId(SystemRole::Cashier)]])
            ->assertStatus(422)->assertJsonPath('error.code', 'LAST_ORGANIZATION_ADMIN');
        $this->patchJson("/api/v1/users/{$second->id}", ['status' => 'inactive'])
            ->assertStatus(422)->assertJsonPath('error.code', 'LAST_ORGANIZATION_ADMIN');

        $this->assertTrue($second->fresh()->isActive());
        $this->assertTrue($second->roles()->where('system_key', SystemRole::OrganizationAdmin->value)->exists());
    }

    public function test_user_managers_cannot_escalate_privileges(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $hrRoleId = $this->actingAsUser($admin)
            ->postJson('/api/v1/roles', ['name' => 'HR', 'permissions' => ['users.view', 'users.manage']])
            ->assertCreated()->json('data.id');
        $hr = $this->createUserWithRole($org, Role::query()->withoutGlobalScopes()->findOrFail($hrRoleId));
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);

        $this->actingAsUser($hr);

        // Creating an admin account they would control.
        $this->postJson('/api/v1/users', [
            'name' => 'Puppet', 'email' => 'puppet@acme.test', 'password' => 'password1',
            'role_ids' => [$this->roleId(SystemRole::OrganizationAdmin)], 'branch_ids' => [$branch->id],
        ])->assertStatus(422)->assertJsonPath('error.code', 'PRIVILEGE_ESCALATION');
        $this->assertDatabaseMissing('users', ['email' => 'puppet@acme.test']);

        // Taking over the admin account via a password reset.
        $this->patchJson("/api/v1/users/{$admin->id}", ['password' => 'taken-over9'])
            ->assertStatus(422)->assertJsonPath('error.code', 'PRIVILEGE_ESCALATION');

        // Peers and less powerful users remain manageable; roles within their own permissions are assignable.
        $this->patchJson("/api/v1/users/{$cashier->id}", ['role_ids' => [$hrRoleId]])
            ->assertStatus(422)->assertJsonPath('error.code', 'PRIVILEGE_ESCALATION'); // cashier has branches.view, HR does not
        $peer = $this->createUserWithRole($org, Role::query()->withoutGlobalScopes()->findOrFail($hrRoleId));
        $this->actingAsUser($hr)->patchJson("/api/v1/users/{$peer->id}", ['name' => 'Renamed peer'])->assertOk();
    }

    public function test_deactivation_and_password_reset_by_admin_revoke_credentials(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);
        $cashier->createToken('till');

        $this->actingAsUser($admin)->patchJson("/api/v1/users/{$cashier->id}", ['password' => 'temporary9'])->assertOk();
        $this->assertTrue(Hash::check('temporary9', $cashier->fresh()->password));
        $this->assertSame(0, $cashier->tokens()->count());

        $cashier->createToken('till-2');
        $this->actingAsUser($admin)->patchJson("/api/v1/users/{$cashier->id}", ['status' => 'inactive'])
            ->assertOk()->assertJsonPath('data.status', 'inactive');
        $this->assertSame(0, $cashier->tokens()->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'user.updated', 'subject_id' => $cashier->id]);
    }
}
