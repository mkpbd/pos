<?php

namespace App\Modules\Authentication\Tests\Feature;

use App\Modules\Authentication\Domain\TwoFactor\Totp;
use App\Modules\Authentication\Infrastructure\Notifications\TwoFactorChangedNotification;
use App\Modules\Authentication\Tests\Concerns\InteractsWithTwoFactor;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/**
 * G1a: a user's own two-factor setup, recovery codes and turning it off; an administrator's reset.
 */
class TwoFactorManagementTest extends TestCase
{
    use InteractsWithTenancy, InteractsWithTwoFactor, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->freezeSecond();
        Notification::fake();
    }

    public function test_setup_and_confirm_turn_two_factor_on_and_show_recovery_codes_once(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant('Acme Retail');
        $this->actingAsUser($admin);

        $this->getJson('/api/v1/auth/two-factor')->assertOk()->assertJsonPath('data', [
            'enabled' => false, 'confirmed_at' => null, 'required' => false, 'recovery_codes_left' => null, 'pending_setup' => false,
        ]);

        $this->postJson('/api/v1/auth/two-factor/setup', ['password' => 'wrong-pass1'])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'INVALID_PASSWORD')
            ->assertJsonStructure(['error' => ['details' => ['password']]]);

        $this->postJson('/api/v1/auth/two-factor/confirm', ['code' => '123456'])
            ->assertStatus(422)->assertJsonPath('error.code', 'TWO_FACTOR_NOT_STARTED');

        $first = $this->postJson('/api/v1/auth/two-factor/setup', ['password' => 'password1'])->assertOk();
        $setup = $this->postJson('/api/v1/auth/two-factor/setup', ['password' => 'password1'])->assertOk();
        $secret = $setup->json('data.secret');
        $this->assertNotSame($first->json('data.secret'), $secret);
        $this->assertMatchesRegularExpression('/^[A-Z2-7]{32}$/', $secret);
        $this->assertSame(
            'otpauth://totp/Acme%20Retail:'.rawurlencode($admin->email).'?secret='.$secret.'&issuer=Acme%20Retail&algorithm=SHA1&digits=6&period=30',
            $setup->json('data.otpauth_uri'),
        );
        $this->getJson('/api/v1/auth/two-factor')->assertJsonPath('data.pending_setup', true)->assertJsonPath('data.enabled', false);
        // An unconfirmed secret does not turn two-factor on.
        $this->assertFalse($admin->fresh()->hasTwoFactorEnabled());

        $this->postJson('/api/v1/auth/two-factor/confirm', ['code' => app(Totp::class)->at($first->json('data.secret'), now()->getTimestamp())])
            ->assertStatus(422)->assertJsonPath('error.code', 'INVALID_TWO_FACTOR_CODE');

        $this->travel(61)->seconds(); // past throttle:auth (5 a minute)

        $confirm = $this->postJson('/api/v1/auth/two-factor/confirm', ['code' => $this->totpCode($secret)])->assertOk();
        $codes = $confirm->json('data.recovery_codes');
        $this->assertCount(10, $codes);
        $this->assertMatchesRegularExpression('/^[a-z0-9]{5}-[a-z0-9]{5}$/', $codes[0]);

        $this->getJson('/api/v1/auth/two-factor')->assertOk()
            ->assertJsonPath('data.enabled', true)
            ->assertJsonPath('data.recovery_codes_left', 10)
            ->assertJsonPath('data.pending_setup', false)
            ->assertJsonPath('data.confirmed_at', now()->toIso8601String());
        $this->getJson('/api/v1/auth/me')->assertJsonPath('data.two_factor.enabled', true);

        $this->postJson('/api/v1/auth/two-factor/setup', ['password' => 'password1'])
            ->assertStatus(422)->assertJsonPath('error.code', 'TWO_FACTOR_ALREADY_ENABLED');

        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.two_factor_enabled', 'subject_id' => $admin->id, 'organization_id' => $org->id]);
        Notification::assertSentTo($admin, TwoFactorChangedNotification::class, fn ($n) => $n->change === 'enabled');

        // Stored encrypted and hashed only.
        $row = DB::table('users')->where('id', $admin->id)->first();
        $this->assertStringNotContainsString($secret, (string) $row->two_factor_secret);
        $this->assertStringNotContainsString($codes[0], (string) $row->two_factor_recovery_codes);
        $this->assertStringNotContainsString($secret, (string) json_encode(DB::table('audit_logs')->get()));
        $this->assertArrayNotHasKey('two_factor_secret', $admin->fresh()->toArray());
    }

    public function test_new_recovery_codes_replace_the_old_ones(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        ['recovery_codes' => $old] = $this->enableTwoFactor($admin);
        $this->actingAsUser($admin);

        $this->postJson('/api/v1/auth/two-factor/recovery-codes', ['password' => 'nope-nope1'])
            ->assertStatus(422)->assertJsonPath('error.code', 'INVALID_PASSWORD');
        $new = $this->postJson('/api/v1/auth/two-factor/recovery-codes', ['password' => 'password1'])
            ->assertOk()->json('data.recovery_codes');

        $this->assertCount(10, $new);
        $this->assertEmpty(array_intersect($old, $new));
        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.recovery_codes_regenerated', 'subject_id' => $admin->id]);

        // An old code no longer turns two-factor off; a new one does.
        $this->deleteJson('/api/v1/auth/two-factor', ['password' => 'password1', 'code' => $old[0]])
            ->assertStatus(422)->assertJsonPath('error.code', 'INVALID_TWO_FACTOR_CODE');
        $this->deleteJson('/api/v1/auth/two-factor', ['password' => 'password1', 'code' => $new[0]])->assertNoContent();
    }

    public function test_recovery_codes_need_two_factor_on(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $this->postJson('/api/v1/auth/two-factor/recovery-codes', ['password' => 'password1'])
            ->assertStatus(422)->assertJsonPath('error.code', 'TWO_FACTOR_NOT_ENABLED');
    }

    public function test_turning_off_needs_password_and_a_code(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        ['secret' => $secret] = $this->enableTwoFactor($admin);
        $this->actingAsUser($admin);

        $this->deleteJson('/api/v1/auth/two-factor', ['password' => 'password1'])
            ->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
        $this->deleteJson('/api/v1/auth/two-factor', ['password' => 'wrong-pass1', 'code' => $this->totpCode($secret)])
            ->assertStatus(422)->assertJsonPath('error.code', 'INVALID_PASSWORD');
        $this->deleteJson('/api/v1/auth/two-factor', ['password' => 'password1', 'code' => $this->wrongTotpCode($secret)])
            ->assertStatus(422)->assertJsonPath('error.code', 'INVALID_TWO_FACTOR_CODE');

        $this->deleteJson('/api/v1/auth/two-factor', ['password' => 'password1', 'code' => $this->totpCode($secret)])->assertNoContent();

        $fresh = $admin->fresh();
        $this->assertFalse($fresh->hasTwoFactorEnabled());
        $this->assertNull($fresh->getAttributes()['two_factor_secret']);
        $this->assertNull($fresh->getAttributes()['two_factor_recovery_codes']);
        $this->assertNull($fresh->two_factor_last_step);
        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.two_factor_disabled', 'subject_id' => $admin->id]);
        Notification::assertSentTo($admin, TwoFactorChangedNotification::class, fn ($n) => $n->change === 'disabled');

        $this->deleteJson('/api/v1/auth/two-factor', ['password' => 'password1', 'code' => '123456'])
            ->assertStatus(422)->assertJsonPath('error.code', 'TWO_FACTOR_NOT_ENABLED');
    }

    public function test_cannot_turn_off_while_the_organization_requires_it(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        ['secret' => $secret] = $this->enableTwoFactor($admin);
        $this->setTwoFactorPolicy($org, 'admins');
        $this->actingAsUser($admin);

        $this->getJson('/api/v1/auth/two-factor')->assertJsonPath('data.required', true);
        $this->deleteJson('/api/v1/auth/two-factor', ['password' => 'password1', 'code' => $this->totpCode($secret)])
            ->assertStatus(422)->assertJsonPath('error.code', 'TWO_FACTOR_REQUIRED_BY_POLICY');
        $this->assertTrue($admin->fresh()->hasTwoFactorEnabled());
    }

    public function test_administrator_resets_another_users_two_factor(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);
        $this->enableTwoFactor($cashier);
        $this->actingAsUser($admin);

        $this->getJson("/api/v1/users/{$cashier->id}")->assertOk()->assertJsonPath('data.two_factor_enabled', true);

        $this->postJson("/api/v1/users/{$cashier->id}/two-factor/reset")
            ->assertOk()
            ->assertJsonPath('data.id', $cashier->id)
            ->assertJsonPath('data.two_factor_enabled', false);

        $this->assertFalse($cashier->fresh()->hasTwoFactorEnabled());
        $this->assertNull($cashier->fresh()->getAttributes()['two_factor_secret']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'user.two_factor_reset', 'subject_id' => $cashier->id, 'user_id' => $admin->id]);
        Notification::assertSentTo($cashier, TwoFactorChangedNotification::class, fn ($n) => $n->change === 'reset');
    }

    public function test_administrator_cannot_reset_own_two_factor_nor_more_powerful_users(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->enableTwoFactor($admin);
        $manager = $this->createUserWithRole($org, SystemRole::BranchManager);
        $manager->roles()->first()->permissions()->syncWithoutDetaching(['users.manage']);
        $this->actingAsUser($admin);

        $this->postJson("/api/v1/users/{$admin->id}/two-factor/reset")
            ->assertStatus(422)->assertJsonPath('error.code', 'CANNOT_RESET_OWN_TWO_FACTOR');

        $this->actingAsUser($manager);
        $this->postJson("/api/v1/users/{$admin->id}/two-factor/reset")
            ->assertStatus(422)->assertJsonPath('error.code', 'PRIVILEGE_ESCALATION');
        $this->assertTrue($admin->fresh()->hasTwoFactorEnabled());
    }

    public function test_reset_needs_users_manage_and_is_tenant_scoped(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);
        $this->enableTwoFactor($cashier);
        ['admin' => $otherAdmin] = $this->provisionTenant('Other Co');

        $this->actingAsUser($otherAdmin);
        $this->postJson("/api/v1/users/{$cashier->id}/two-factor/reset")->assertNotFound();

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier));
        $this->postJson("/api/v1/users/{$cashier->id}/two-factor/reset")->assertForbidden();

        $this->assertTrue($cashier->fresh()->hasTwoFactorEnabled());
    }
}
