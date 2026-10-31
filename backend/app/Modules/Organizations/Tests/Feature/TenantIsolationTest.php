<?php

namespace App\Modules\Organizations\Tests\Feature;

use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Enums\UserStatus;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Critical workflow #12: organization- and branch-level data isolation.
 */
class TenantIsolationTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    public function test_lists_only_contain_own_organization_data(): void
    {
        ['admin' => $adminA] = $this->provisionTenant('Alpha');
        ['branch' => $branchB, 'organization' => $orgB] = $this->provisionTenant('Beta');

        $this->actingAsUser($adminA);

        $users = $this->getJson('/api/v1/users')->assertOk()->json('data.*.id');
        $branches = $this->getJson('/api/v1/branches')->assertOk()->json('data.*.id');
        $roles = $this->getJson('/api/v1/roles')->assertOk()->json('data.*.id');

        $this->assertSame([$adminA->id], $users);
        $this->assertNotContains($branchB->id, $branches);
        $this->assertCount(count(SystemRole::cases()), $roles);
        $this->assertEmpty(array_intersect($roles, $this->inTenant($orgB, fn () => Role::query()->pluck('id')->all())));
    }

    public function test_other_organizations_records_are_not_found(): void
    {
        ['admin' => $adminA] = $this->provisionTenant('Alpha');
        ['admin' => $adminB, 'branch' => $branchB, 'organization' => $orgB] = $this->provisionTenant('Beta');
        $roleB = $this->inTenant($orgB, fn () => Role::query()->firstOrFail());

        $this->actingAsUser($adminA);

        $this->getJson("/api/v1/users/{$adminB->id}")->assertNotFound()->assertJsonPath('error.code', 'NOT_FOUND');
        $this->patchJson("/api/v1/users/{$adminB->id}", ['name' => 'Hijacked'])->assertNotFound();
        $this->getJson("/api/v1/branches/{$branchB->id}")->assertNotFound();
        $this->patchJson("/api/v1/branches/{$branchB->id}", ['name' => 'Hijacked'])->assertNotFound();
        $this->getJson("/api/v1/roles/{$roleB->id}")->assertNotFound();

        $this->assertDatabaseMissing('users', ['name' => 'Hijacked']);
        $this->assertDatabaseMissing('branches', ['name' => 'Hijacked']);
    }

    public function test_foreign_roles_and_branches_cannot_be_assigned(): void
    {
        ['admin' => $adminA, 'branch' => $branchA, 'organization' => $orgA] = $this->provisionTenant('Alpha');
        ['branch' => $branchB, 'organization' => $orgB] = $this->provisionTenant('Beta');
        $roleB = $this->inTenant($orgB, fn () => Role::query()->where('system_key', SystemRole::Cashier->value)->firstOrFail());
        $cashierA = $this->inTenant($orgA, fn () => Role::query()->where('system_key', SystemRole::Cashier->value)->firstOrFail());

        $this->actingAsUser($adminA);
        $base = ['name' => 'Mallory', 'email' => 'mallory@alpha.test', 'password' => 'password1'];

        $this->postJson('/api/v1/users', $base + ['role_ids' => [$roleB->id], 'branch_ids' => [$branchA->id]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['role_ids']]]);
        $this->postJson('/api/v1/users', $base + ['role_ids' => [$cashierA->id], 'branch_ids' => [$branchB->id]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['branch_ids']]]);

        $this->assertDatabaseMissing('users', ['email' => 'mallory@alpha.test']);
    }

    public function test_branch_header_is_validated_against_organization_and_assignment(): void
    {
        ['organization' => $orgA, 'branch' => $mainA] = $this->provisionTenant('Alpha');
        ['branch' => $branchB] = $this->provisionTenant('Beta');
        $otherA = $this->createBranch($orgA, 'NORTH');
        $manager = $this->createUserWithRole($orgA, SystemRole::BranchManager, [$mainA->id]);

        $this->actingAsUser($manager);

        $this->withHeader('X-Branch-Id', $mainA->id)->getJson('/api/v1/branches')->assertOk();
        $this->withHeader('X-Branch-Id', $otherA->id)->getJson('/api/v1/branches')
            ->assertForbidden()->assertJsonPath('error.code', 'BRANCH_ACCESS_DENIED');
        $this->withHeader('X-Branch-Id', $branchB->id)->getJson('/api/v1/branches')
            ->assertForbidden()->assertJsonPath('error.code', 'BRANCH_ACCESS_DENIED');
    }

    public function test_branch_limited_users_only_see_assigned_branches(): void
    {
        ['organization' => $org, 'branch' => $main] = $this->provisionTenant('Alpha');
        $north = $this->createBranch($org, 'NORTH');
        $manager = $this->createUserWithRole($org, SystemRole::BranchManager, [$north->id]);

        $this->actingAsUser($manager);

        $this->assertSame([$north->id], $this->getJson('/api/v1/branches')->assertOk()->json('data.*.id'));
        $this->getJson("/api/v1/branches/{$main->id}")->assertNotFound();
        $this->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.branches.0.id', $north->id)->assertJsonCount(1, 'data.branches');
    }

    public function test_inactive_branch_cannot_be_selected(): void
    {
        ['organization' => $org, 'admin' => $admin] = $this->provisionTenant('Alpha');
        $north = $this->createBranch($org, 'NORTH');
        $north->forceFill(['is_active' => false])->save();

        $this->actingAsUser($admin)
            ->withHeader('X-Branch-Id', $north->id)
            ->getJson('/api/v1/branches')
            ->assertForbidden();
    }

    public function test_deactivated_user_with_live_token_is_rejected(): void
    {
        ['organization' => $org] = $this->provisionTenant('Alpha');
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);
        $token = $cashier->createToken('till')->plainTextToken;
        $cashier->forceFill(['status' => UserStatus::Inactive])->save();

        $this->withToken($token)->getJson('/api/v1/branches')
            ->assertForbidden()->assertJsonPath('error.code', 'ACCOUNT_INACTIVE');
    }
}
