<?php

namespace App\Modules\Authentication\Tests\Feature;

use App\Modules\Authentication\Infrastructure\Notifications\AccountLockedNotification;
use App\Modules\Authentication\Tests\Concerns\InteractsWithTwoFactor;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/**
 * G1a: staff accounts are locked after repeated failed sign-ins.
 */
class AccountLockoutTest extends TestCase
{
    use InteractsWithTenancy, InteractsWithTwoFactor, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->freezeSecond();
        Notification::fake();
        config(['pos.lockout.max_attempts' => 3, 'pos.lockout.minutes' => 15, 'pos.auth_rate_limit' => 100]);
    }

    public function test_reaching_the_threshold_locks_the_account_and_refuses_even_the_right_password(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();

        $this->failPassword($admin->email);
        $this->failPassword($admin->email);
        $this->assertSame(2, $admin->fresh()->failed_login_count);
        $this->failPassword($admin->email);

        $fresh = $admin->fresh();
        $this->assertSame(0, $fresh->failed_login_count);
        $this->assertEquals(now()->addMinutes(15), $fresh->locked_until);
        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.account_locked', 'subject_id' => $admin->id, 'organization_id' => $org->id, 'user_id' => null]);
        Notification::assertSentTo($admin, AccountLockedNotification::class, fn ($n) => $n->minutes === 15);

        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/login', ['email' => $admin->email, 'password' => 'password1'])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'ACCOUNT_LOCKED')
            ->assertJsonPath('error.message', 'Too many failed sign-ins. Try again in 15 minutes or ask your administrator.')
            ->assertJsonPath('error.details.retry_after_seconds', 900);
        $this->assertGuest('web');
        $this->assertDatabaseHas('login_activities', ['user_id' => $admin->id, 'failure_reason' => 'account_locked']);

        $this->postJson('/api/v1/auth/tokens', ['email' => $admin->email, 'password' => 'password1', 'device_name' => 'x'])
            ->assertStatus(422)->assertJsonPath('error.code', 'ACCOUNT_LOCKED');

        // A wrong password while locked does not extend the lock or count.
        $this->failPassword($admin->email, 'ACCOUNT_LOCKED');
        $this->assertEquals(now()->addMinutes(15), $admin->fresh()->locked_until);

        // The lock ends by itself.
        $this->travel(15)->minutes();
        $this->travel(1)->seconds();
        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/login', ['email' => $admin->email, 'password' => 'password1'])
            ->assertOk();
        $this->assertNull($admin->fresh()->locked_until);
    }

    public function test_successful_sign_in_resets_the_count(): void
    {
        ['admin' => $admin] = $this->provisionTenant();

        $this->failPassword($admin->email);
        $this->failPassword($admin->email);
        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/login', ['email' => $admin->email, 'password' => 'password1'])
            ->assertOk();
        $this->assertSame(0, $admin->fresh()->failed_login_count);

        $this->failPassword($admin->email);
        $this->failPassword($admin->email);
        $this->assertNull($admin->fresh()->locked_until);
    }

    public function test_wrong_two_factor_codes_count_and_the_challenge_is_refused_while_locked(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        ['secret' => $secret] = $this->enableTwoFactor($admin);

        $this->failPassword($admin->email);
        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/login', ['email' => $admin->email, 'password' => 'password1'])
            ->assertJsonPath('data.two_factor_required', true);
        // Correct password with 2FA pending does not reset the count yet.
        $this->assertSame(1, $admin->fresh()->failed_login_count);

        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/two-factor-challenge', ['code' => $this->wrongTotpCode($secret)])
            ->assertJsonPath('error.code', 'INVALID_TWO_FACTOR_CODE');
        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/two-factor-challenge', ['code' => $this->wrongTotpCode($secret)])
            ->assertJsonPath('error.code', 'INVALID_TWO_FACTOR_CODE');

        $this->assertTrue($admin->fresh()->isLocked());
        Notification::assertSentTo($admin, AccountLockedNotification::class);

        // The lock ended the challenge; a new sign-in is refused while locked.
        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/two-factor-challenge', ['code' => $this->totpCode($secret)])
            ->assertJsonPath('error.code', 'TWO_FACTOR_CHALLENGE_EXPIRED');
        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/login', ['email' => $admin->email, 'password' => 'password1'])
            ->assertJsonPath('error.code', 'ACCOUNT_LOCKED');
    }

    public function test_challenge_refused_when_the_account_got_locked_meanwhile(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        ['secret' => $secret] = $this->enableTwoFactor($admin);
        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/login', ['email' => $admin->email, 'password' => 'password1'])
            ->assertJsonPath('data.two_factor_required', true);

        $admin->forceFill(['locked_until' => now()->addMinutes(10)])->save();

        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/two-factor-challenge', ['code' => $this->totpCode($secret)])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'ACCOUNT_LOCKED')
            ->assertJsonPath('error.details.retry_after_seconds', 600);
        $this->assertGuest('web');
    }

    public function test_password_reset_by_email_clears_the_lock(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $admin->forceFill(['locked_until' => now()->addMinutes(10), 'failed_login_count' => 2])->save();

        $this->postJson('/api/v1/auth/forgot-password', ['email' => $admin->email])->assertOk();
        $token = null;
        Notification::assertSentTo($admin, ResetPassword::class, function (ResetPassword $n) use (&$token) {
            $token = $n->token;

            return true;
        });
        $this->postJson('/api/v1/auth/reset-password', [
            'token' => $token, 'email' => $admin->email, 'password' => 'brand-new-9', 'password_confirmation' => 'brand-new-9',
        ])->assertOk();

        $fresh = $admin->fresh();
        $this->assertNull($fresh->locked_until);
        $this->assertSame(0, $fresh->failed_login_count);
        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/login', ['email' => $admin->email, 'password' => 'brand-new-9'])
            ->assertOk();
    }

    public function test_administrator_unlocks_a_user(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);
        $cashier->forceFill(['locked_until' => now()->addMinutes(10), 'failed_login_count' => 1])->save();

        $this->actingAsUser($admin)->getJson("/api/v1/users/{$cashier->id}")
            ->assertOk()
            ->assertJsonPath('data.is_locked', true)
            ->assertJsonPath('data.locked_until', now()->addMinutes(10)->toIso8601String())
            ->assertJsonPath('data.two_factor_enabled', false);
        $this->getJson('/api/v1/users?search='.urlencode($cashier->email))->assertOk()->assertJsonPath('data.0.is_locked', true);

        $this->postJson("/api/v1/users/{$cashier->id}/unlock")
            ->assertOk()
            ->assertJsonPath('data.is_locked', false)
            ->assertJsonPath('data.locked_until', null);

        $this->assertNull($cashier->fresh()->locked_until);
        $this->assertSame(0, $cashier->fresh()->failed_login_count);
        $this->assertDatabaseHas('audit_logs', ['action' => 'user.unlocked', 'subject_id' => $cashier->id, 'user_id' => $admin->id]);
        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/login', ['email' => $cashier->email, 'password' => 'password1'])
            ->assertOk();
    }

    public function test_unlock_needs_users_manage_and_is_tenant_scoped(): void
    {
        ['organization' => $org] = $this->provisionTenant();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);
        $cashier->forceFill(['locked_until' => now()->addMinutes(10)])->save();
        ['admin' => $otherAdmin] = $this->provisionTenant('Other Co');

        $this->actingAsUser($otherAdmin)->postJson("/api/v1/users/{$cashier->id}/unlock")->assertNotFound();
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier))->postJson("/api/v1/users/{$cashier->id}/unlock")->assertForbidden();

        $this->assertTrue($cashier->fresh()->isLocked());
    }

    public function test_unknown_emails_are_not_tracked(): void
    {
        $this->failPassword('ghost@example.test');

        $this->assertSame(0, DB::table('audit_logs')->where('action', 'auth.account_locked')->count());
    }

    private function failPassword(string $email, string $expectedCode = 'INVALID_CREDENTIALS'): void
    {
        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/login', ['email' => $email, 'password' => 'wrong-password1'])
            ->assertStatus(422)
            ->assertJsonPath('error.code', $expectedCode);
    }
}
