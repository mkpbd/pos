<?php

namespace App\Modules\Authentication\Tests\Feature;

use App\Modules\Authentication\Infrastructure\Models\LoginActivity;
use App\Modules\Organizations\Domain\Enums\OrganizationStatus;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Enums\UserStatus;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SessionAuthenticationTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    public function test_spa_login_returns_profile_with_permissions_and_branches(): void
    {
        ['admin' => $admin, 'branch' => $branch, 'organization' => $org] = $this->provisionTenant();

        $response = $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/login', ['email' => $admin->email, 'password' => 'password1']);

        $response->assertOk()
            ->assertJsonPath('data.user.email', $admin->email)
            ->assertJsonPath('data.organization.id', $org->id)
            ->assertJsonPath('data.organization.base_currency', 'BDT')
            ->assertJsonPath('data.roles.0.system_key', SystemRole::OrganizationAdmin->value)
            ->assertJsonPath('data.branches.0.id', $branch->id);
        $this->assertContains('users.manage', $response->json('data.permissions'));
        $this->assertAuthenticatedAs($admin, 'web');

        $this->assertDatabaseHas('login_activities', ['user_id' => $admin->id, 'succeeded' => true, 'channel' => 'session']);
        $this->assertNotNull($admin->fresh()->last_login_at);

        $this->withHeaders($this->spaHeaders())->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.user.id', $admin->id);
    }

    public function test_login_is_case_insensitive_on_email(): void
    {
        ['admin' => $admin] = $this->provisionTenant();

        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/login', ['email' => strtoupper($admin->email), 'password' => 'password1'])
            ->assertOk();
    }

    public function test_wrong_password_and_unknown_email_fail_identically_and_are_recorded(): void
    {
        ['admin' => $admin] = $this->provisionTenant();

        $wrong = $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/login', ['email' => $admin->email, 'password' => 'nope-nope1']);
        $unknown = $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/login', ['email' => 'ghost@example.test', 'password' => 'nope-nope1']);

        $wrong->assertStatus(422)->assertJsonPath('error.code', 'INVALID_CREDENTIALS');
        $unknown->assertStatus(422)->assertJsonPath('error.code', 'INVALID_CREDENTIALS');
        $this->assertSame($wrong->json('error.message'), $unknown->json('error.message'));
        $this->assertGuest('web');

        $this->assertSame(2, LoginActivity::query()->where('succeeded', false)->count());
        $this->assertDatabaseHas('login_activities', ['user_id' => $admin->id, 'failure_reason' => 'invalid_credentials']);
    }

    public function test_inactive_user_cannot_log_in(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $admin->forceFill(['status' => UserStatus::Inactive])->save();

        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/login', ['email' => $admin->email, 'password' => 'password1'])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'ACCOUNT_INACTIVE');
    }

    public function test_users_of_suspended_organization_cannot_log_in(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $org->forceFill(['status' => OrganizationStatus::Suspended])->save();

        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/login', ['email' => $admin->email, 'password' => 'password1'])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'ORGANIZATION_SUSPENDED');
    }

    public function test_login_is_rate_limited(): void
    {
        ['admin' => $admin] = $this->provisionTenant();

        for ($i = 0; $i < 5; $i++) {
            $this->withHeaders($this->spaHeaders())
                ->postJson('/api/v1/auth/login', ['email' => $admin->email, 'password' => 'wrong-pass1'])
                ->assertStatus(422);
        }

        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/login', ['email' => $admin->email, 'password' => 'password1'])
            ->assertStatus(429)
            ->assertJsonPath('error.code', 'TOO_MANY_REQUESTS');
    }

    public function test_session_login_is_refused_for_non_spa_clients(): void
    {
        ['admin' => $admin] = $this->provisionTenant();

        $this->postJson('/api/v1/auth/login', ['email' => $admin->email, 'password' => 'password1'])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'SESSION_UNAVAILABLE');
    }

    public function test_logout_ends_the_session(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/login', ['email' => $admin->email, 'password' => 'password1'])->assertOk();

        $this->withHeaders($this->spaHeaders())->postJson('/api/v1/auth/logout')->assertNoContent();

        $this->assertGuest('web');
        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.logout', 'subject_id' => $admin->id]);
    }

    public function test_me_requires_authentication(): void
    {
        $this->getJson('/api/v1/auth/me')->assertStatus(401)->assertJsonPath('error.code', 'UNAUTHENTICATED');
    }
}
