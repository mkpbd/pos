<?php

namespace App\Modules\Authentication\Tests\Feature;

use App\Modules\Authentication\Tests\Concerns\InteractsWithTwoFactor;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * G1a: the organization's two-factor policy, the setup-required gate and the security summary.
 */
class TwoFactorPolicyTest extends TestCase
{
    use InteractsWithTenancy, InteractsWithTwoFactor, RefreshDatabase;

    public function test_optional_policy_forces_nobody(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();

        $this->actingAsUser($admin)->getJson('/api/v1/auth/me')
            ->assertOk()
            ->assertJsonPath('data.two_factor', ['enabled' => false, 'required' => false, 'setup_required' => false]);
        $this->getJson('/api/v1/users')->assertOk();
        $this->getJson('/api/v1/organization')->assertOk()->assertJsonPath('data.settings.two_factor_policy', 'optional');
    }

    public function test_admins_policy_gates_administrators_until_they_set_it_up(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);
        $this->setTwoFactorPolicy($org, 'admins');

        $this->actingAsUser($admin)->getJson('/api/v1/auth/me')
            ->assertOk()
            ->assertJsonPath('data.two_factor', ['enabled' => false, 'required' => true, 'setup_required' => true]);

        // Blocked: everything else.
        $this->getJson('/api/v1/users')->assertForbidden()->assertJsonPath('error.code', 'TWO_FACTOR_SETUP_REQUIRED');
        $this->getJson('/api/v1/organization')->assertForbidden()->assertJsonPath('error.code', 'TWO_FACTOR_SETUP_REQUIRED');
        $this->getJson('/api/v1/auth/tokens')->assertForbidden()->assertJsonPath('error.code', 'TWO_FACTOR_SETUP_REQUIRED');
        $this->getJson('/api/v1/auth/login-activity')->assertForbidden();

        // Allowed: identity, sign-out, password and the two-factor screens; public routes.
        $this->getJson('/api/v1/auth/two-factor')->assertOk()->assertJsonPath('data.required', true);
        $this->getJson('/api/v1/auth/options')->assertOk();
        $this->putJson('/api/v1/auth/password', [])->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
        $secret = $this->postJson('/api/v1/auth/two-factor/setup', ['password' => 'password1'])->assertOk()->json('data.secret');
        $this->postJson('/api/v1/auth/two-factor/confirm', ['code' => $this->totpCode($secret)])->assertOk();

        $this->getJson('/api/v1/users')->assertOk();
        $this->getJson('/api/v1/auth/me')->assertJsonPath('data.two_factor', ['enabled' => true, 'required' => true, 'setup_required' => false]);

        // Cashiers are not administrators.
        $this->actingAsUser($cashier)->getJson('/api/v1/auth/me')->assertJsonPath('data.two_factor.required', false);
        $this->getJson('/api/v1/auth/tokens')->assertOk();
    }

    public function test_everyone_policy_gates_every_staff_user_and_logout_stays_possible(): void
    {
        ['organization' => $org] = $this->provisionTenant();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);
        $this->setTwoFactorPolicy($org, 'everyone');

        $this->actingAsUser($cashier)->getJson('/api/v1/auth/tokens')
            ->assertForbidden()->assertJsonPath('error.code', 'TWO_FACTOR_SETUP_REQUIRED');
        $this->getJson('/api/v1/auth/me')->assertJsonPath('data.two_factor.setup_required', true);

        $this->enableTwoFactor($cashier);
        $this->actingAsUser($cashier)->getJson('/api/v1/auth/tokens')->assertOk();
    }

    public function test_session_login_still_succeeds_for_a_user_who_must_set_up(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->setTwoFactorPolicy($org, 'everyone');

        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/login', ['email' => $admin->email, 'password' => 'password1'])
            ->assertOk()
            ->assertJsonPath('data.user.id', $admin->id)
            ->assertJsonPath('data.two_factor.setup_required', true);
        $this->withHeaders($this->spaHeaders())->getJson('/api/v1/users')
            ->assertForbidden()->assertJsonPath('error.code', 'TWO_FACTOR_SETUP_REQUIRED');
        $this->withHeaders($this->spaHeaders())->postJson('/api/v1/auth/logout')->assertNoContent();
    }

    public function test_device_tokens_are_refused_and_existing_ones_blocked_until_setup(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $existing = $admin->createToken('Counter 1')->plainTextToken;
        $this->setTwoFactorPolicy($org, 'admins');

        $this->postJson('/api/v1/auth/tokens', ['email' => $admin->email, 'password' => 'password1', 'device_name' => 'Counter 2'])
            ->assertForbidden()
            ->assertJsonPath('error.code', 'TWO_FACTOR_SETUP_REQUIRED')
            ->assertJsonPath('error.message', 'Set up two-factor sign-in in the web app first.');
        $this->assertSame(1, $admin->tokens()->count());

        $this->withToken($existing)->getJson('/api/v1/users')
            ->assertForbidden()->assertJsonPath('error.code', 'TWO_FACTOR_SETUP_REQUIRED');
        $this->withToken($existing)->getJson('/api/v1/auth/me')->assertOk();

        $this->enableTwoFactor($admin);
        $this->app['auth']->forgetGuards();
        $this->withToken($existing)->getJson('/api/v1/users')->assertOk();
    }

    public function test_platform_admins_are_never_forced_by_an_organization(): void
    {
        ['organization' => $org] = $this->provisionTenant();
        $this->setTwoFactorPolicy($org, 'everyone');
        $platform = User::factory()->platformAdmin()->create();

        $this->actingAsUser($platform)
            ->withHeaders(['X-Organization-Id' => $org->id])
            ->getJson('/api/v1/users')
            ->assertOk();
        $this->getJson('/api/v1/auth/me')->assertJsonPath('data.two_factor.required', false);
    }

    public function test_organization_policy_setting_is_validated_audited_and_summarised(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);
        $manager = $this->createUserWithRole($org, SystemRole::BranchManager);
        $this->enableTwoFactor($cashier);
        $this->actingAsUser($admin);

        $this->getJson('/api/v1/organization')->assertOk()
            ->assertJsonPath('data.settings.two_factor_policy', 'optional')
            ->assertJsonPath('data.two_factor_summary', ['users' => 3, 'enabled' => 1, 'required_missing' => 0]);

        $this->patchJson('/api/v1/organization', ['settings' => ['two_factor_policy' => 'always']])
            ->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');

        $this->patchJson('/api/v1/organization', ['settings' => ['two_factor_policy' => 'everyone']])
            ->assertOk()
            ->assertJsonPath('data.settings.two_factor_policy', 'everyone')
            ->assertJsonPath('data.two_factor_summary', ['users' => 3, 'enabled' => 1, 'required_missing' => 2]);

        $audit = DB::table('audit_logs')->where('action', 'organization.updated')->where('subject_id', $org->id)->first();
        $this->assertSame('optional', json_decode($audit->old_values, true)['two_factor_policy']);
        $this->assertSame('everyone', json_decode($audit->new_values, true)['two_factor_policy']);

        $this->enableTwoFactor($admin);
        $this->actingAsUser($admin)->patchJson('/api/v1/organization', ['settings' => ['two_factor_policy' => 'admins']])
            ->assertOk()
            ->assertJsonPath('data.two_factor_summary', ['users' => 3, 'enabled' => 2, 'required_missing' => 0]);

        // Viewers without organization.update see the policy but not the summary.
        $this->actingAsUser($manager)->getJson('/api/v1/organization')->assertOk()
            ->assertJsonPath('data.settings.two_factor_policy', 'admins')
            ->assertJsonMissingPath('data.two_factor_summary');
    }

    public function test_summary_counts_only_the_organizations_own_active_users(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        ['admin' => $otherAdmin] = $this->provisionTenant('Other Co');
        $this->enableTwoFactor($otherAdmin);
        $this->setTwoFactorPolicy($org, 'everyone');
        $this->enableTwoFactor($admin);

        $this->actingAsUser($admin)->getJson('/api/v1/organization')
            ->assertJsonPath('data.two_factor_summary', ['users' => 1, 'enabled' => 1, 'required_missing' => 0]);
    }
}
