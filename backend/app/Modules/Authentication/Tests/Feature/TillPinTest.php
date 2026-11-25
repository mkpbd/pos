<?php

namespace App\Modules\Authentication\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\Authentication\Infrastructure\Models\LoginActivity;
use App\Modules\Authentication\Tests\Concerns\InteractsWithTwoFactor;
use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Pos\Tests\Concerns\InteractsWithTills;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Enums\UserStatus;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * POS1a §1: till PINs — set / remove / administrator clear, sign-in with a PIN at a till
 * (lockout, two-factor refusal, quick switch), screen unlock, throttles and audit.
 */
class TillPinTest extends TestCase
{
    use InteractsWithStock, InteractsWithTenancy, InteractsWithTills, InteractsWithTwoFactor, RefreshDatabase;

    public function test_a_user_sets_changes_and_removes_their_pin_with_the_current_password(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $this->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.pin_set', false)->assertJsonPath('data.user.pin_set', false);

        $this->putJson('/api/v1/profile/pin', ['current_password' => 'wrong-pass1', 'pin' => '2580'])
            ->assertStatus(422)->assertJsonValidationErrors('current_password', 'error.details');
        // The PIN rules themselves: PinRulesTest. (Credential routes allow 5 requests a minute.)
        $this->putJson('/api/v1/profile/pin', ['current_password' => 'password1', 'pin' => '1234'])
            ->assertStatus(422)->assertJsonValidationErrors('pin', 'error.details');

        $this->putJson('/api/v1/profile/pin', ['current_password' => 'password1', 'pin' => '2580'])->assertNoContent();
        $this->assertTrue(password_verify('2580', (string) $admin->fresh()->pin_hash));
        $this->assertNotNull($admin->fresh()->pin_set_at);
        $this->actingAsUser($admin);
        $this->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.pin_set', true);

        $this->putJson('/api/v1/profile/pin', ['current_password' => 'password1', 'pin' => '135790'])->assertNoContent();
        $this->assertTrue(password_verify('135790', (string) $admin->fresh()->pin_hash));

        $this->travel(61)->seconds();
        $this->deleteJson('/api/v1/profile/pin', ['current_password' => 'nope-nope1'])->assertStatus(422);
        $this->deleteJson('/api/v1/profile/pin', ['current_password' => 'password1'])->assertNoContent();
        $this->assertNull($admin->fresh()->pin_hash);

        $audit = AuditLog::query()->withoutGlobalScopes()->where('subject_id', $admin->id)->whereIn('action', ['user.pin_set', 'user.pin_removed'])->orderBy('created_at')->get();
        $this->assertSame(['user.pin_set', 'user.pin_set', 'user.pin_removed'], $audit->pluck('action')->all());
        $this->assertSame([false, true], $audit->take(2)->map(fn ($a) => $a->context['changed'])->all());
        $this->assertPinsNeverLogged();
    }

    public function test_an_administrator_clears_a_pin_of_their_organization_only(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        ['admin' => $otherAdmin] = $this->provisionTenant('Other Shop');
        $cashier = $this->setPin($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));

        $this->actingAsUser($admin);
        $this->getJson("/api/v1/users/{$cashier->id}")->assertOk()->assertJsonPath('data.pin_set', true);
        $this->getJson('/api/v1/users?search='.urlencode($cashier->email))->assertOk()->assertJsonPath('data.0.pin_set', true);

        $this->actingAsUser($otherAdmin);
        $this->deleteJson("/api/v1/users/{$cashier->id}/pin")->assertNotFound();
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $this->deleteJson("/api/v1/users/{$cashier->id}/pin")->assertForbidden();
        $this->assertTrue($cashier->fresh()->hasPin());

        $this->actingAsUser($admin);
        $this->deleteJson("/api/v1/users/{$cashier->id}/pin")->assertNoContent();
        $this->assertFalse($cashier->fresh()->hasPin());
        $this->getJson("/api/v1/users/{$cashier->id}")->assertOk()->assertJsonPath('data.pin_set', false);
        $this->assertDatabaseHas('audit_logs', ['action' => 'user.pin_cleared', 'subject_id' => $cashier->id, 'user_id' => $admin->id]);
    }

    public function test_a_cashier_signs_in_with_a_pin_at_a_till(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $token = $this->tillToken($org, $admin, $store, 'Front till');
        $cashier = $this->setPin($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));

        $response = $this->onTill($token)->postJson('/api/v1/auth/pin', ['user_id' => $cashier->id, 'pin' => '2580']);

        $response->assertOk()
            ->assertJsonPath('data.user.id', $cashier->id)
            ->assertJsonPath('data.pin_set', true)
            ->assertJsonPath('data.organization.id', $org->id);
        $this->assertContains('pos.sell', $response->json('data.permissions'));
        $this->assertAuthenticatedAs($cashier, 'web');
        $this->assertNotNull($cashier->fresh()->last_login_at);

        $terminalId = DB::table('pos_terminals')->value('id');
        $this->assertDatabaseHas('login_activities', ['user_id' => $cashier->id, 'channel' => 'pin', 'succeeded' => true, 'pos_terminal_id' => $terminalId]);
        $login = AuditLog::query()->withoutGlobalScopes()->where('action', 'auth.login')->where('subject_id', $cashier->id)->sole();
        $this->assertSame(['channel' => 'pin', 'pos_terminal_id' => $terminalId], $login->context);
        $this->assertPinsNeverLogged();
    }

    public function test_wrong_pins_count_down_then_lock_the_pin_but_not_the_password(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $token = $this->tillToken($org, $admin, $this->mainStoreId($org));
        $cashier = $this->setPin($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));

        foreach ([4, 3, 2, 1] as $left) {
            $this->onTill($token)->postJson('/api/v1/auth/pin', ['user_id' => $cashier->id, 'pin' => '9999'])
                ->assertStatus(422)
                ->assertJsonPath('error.code', 'PIN_INVALID')
                ->assertJsonPath('error.details.attempts_left', $left);
        }
        $this->onTill($token)->postJson('/api/v1/auth/pin', ['user_id' => $cashier->id, 'pin' => '9999'])
            ->assertStatus(423)
            ->assertJsonPath('error.code', 'PIN_LOCKED')
            ->assertJsonPath('error.details.retry_after', 900);
        // Locked: even the right PIN is refused, and the remaining time is reported.
        $this->travel(5)->minutes();
        $locked = $this->onTill($token)->postJson('/api/v1/auth/pin', ['user_id' => $cashier->id, 'pin' => '2580'])
            ->assertStatus(423)->assertJsonPath('error.code', 'PIN_LOCKED');
        $this->assertEqualsWithDelta(600, $locked->json('error.details.retry_after'), 2);
        $this->assertGuest('web');

        // The password lockout (G1a) is separate.
        $fresh = $cashier->fresh();
        $this->assertSame(0, (int) $fresh->failed_login_count);
        $this->assertNull($fresh->locked_until);
        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.pin_locked', 'subject_id' => $cashier->id]);
        $reasons = LoginActivity::query()->withoutGlobalScopes()->where('user_id', $cashier->id)->where('channel', 'pin')->pluck('failure_reason')->countBy()->all();
        $this->assertSame(['invalid_pin' => 4, 'pin_locked' => 2], $reasons);

        $this->travel(11)->minutes();
        $this->onTill($token)->postJson('/api/v1/auth/pin', ['user_id' => $cashier->id, 'pin' => '2580'])->assertOk();
        $this->assertSame(0, (int) $cashier->fresh()->pin_failed_count);
    }

    public function test_pin_sign_in_is_refused_for_two_factor_accounts_and_like_the_password_sign_in(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $token = $this->tillToken($org, $admin, $this->mainStoreId($org));
        $manager = $this->setPin($this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]));
        $this->enableTwoFactor($manager);

        $this->onTill($token)->postJson('/api/v1/auth/pin', ['user_id' => $manager->id, 'pin' => '2580'])
            ->assertStatus(422)->assertJsonPath('error.code', 'PIN_NOT_ALLOWED');

        // Required by the organization (not set up yet) — refused too.
        $cashier = $this->setPin($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $this->setTwoFactorPolicy($org, 'everyone');
        $this->onTill($token)->postJson('/api/v1/auth/pin', ['user_id' => $cashier->id, 'pin' => '2580'])
            ->assertStatus(422)->assertJsonPath('error.code', 'PIN_NOT_ALLOWED');
        $this->setTwoFactorPolicy($org, 'optional');

        $cashier->forceFill(['locked_until' => now()->addMinutes(10)])->saveQuietly();
        $this->onTill($token)->postJson('/api/v1/auth/pin', ['user_id' => $cashier->id, 'pin' => '2580'])
            ->assertStatus(422)->assertJsonPath('error.code', 'ACCOUNT_LOCKED');
        $cashier->forceFill(['locked_until' => null, 'status' => UserStatus::Inactive])->saveQuietly();
        $this->onTill($token)->postJson('/api/v1/auth/pin', ['user_id' => $cashier->id, 'pin' => '2580'])
            ->assertStatus(422)->assertJsonPath('error.code', 'ACCOUNT_INACTIVE');

        $noPin = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $this->onTill($token)->postJson('/api/v1/auth/pin', ['user_id' => $noPin->id, 'pin' => '2580'])
            ->assertStatus(422)->assertJsonPath('error.code', 'PIN_NOT_SET');
        $this->assertGuest('web');
    }

    public function test_only_the_tills_users_can_sign_in_there(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        ['organization' => $other, 'branch' => $otherBranch] = $this->provisionTenant('Other Shop');
        $token = $this->tillToken($org, $admin, $this->mainStoreId($org));
        $secondBranch = $this->createBranch($org, 'B2');

        $stranger = $this->setPin($this->createUserWithRole($other, SystemRole::Cashier, [$otherBranch->id]));
        $elsewhere = $this->setPin($this->createUserWithRole($org, SystemRole::Cashier, [$secondBranch->id]));
        $noPos = $this->setPin($this->createUserWithRole($org, SystemRole::InventoryManager, [$branch->id]));

        foreach ([$stranger, $elsewhere, $noPos] as $user) {
            $this->onTill($token)->postJson('/api/v1/auth/pin', ['user_id' => $user->id, 'pin' => '2580'])->assertForbidden();
        }
        $this->onTill($token)->postJson('/api/v1/auth/pin', ['user_id' => (string) Str::uuid(), 'pin' => '2580'])->assertForbidden();
        $this->assertSame(0, (int) $stranger->fresh()->pin_failed_count);

        // Without a till cookie, with a made-up or a revoked one: no PIN sign-in.
        $cashier = $this->setPin($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $this->withoutTill()->postJson('/api/v1/auth/pin', ['user_id' => $cashier->id, 'pin' => '2580'])
            ->assertNotFound()->assertJsonPath('error.code', 'TERMINAL_NOT_FOUND');
        $this->onTill(Str::random(64))->postJson('/api/v1/auth/pin', ['user_id' => $cashier->id, 'pin' => '2580'])
            ->assertNotFound()->assertJsonPath('error.code', 'TERMINAL_NOT_FOUND');
        DB::table('pos_terminals')->update(['revoked_at' => now()]);
        $this->onTill($token)->postJson('/api/v1/auth/pin', ['user_id' => $cashier->id, 'pin' => '2580'])
            ->assertNotFound()->assertJsonPath('error.code', 'TERMINAL_NOT_FOUND');
        $this->assertGuest('web');
    }

    public function test_signing_in_with_a_pin_switches_the_cashier(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $token = $this->tillToken($org, $admin, $this->mainStoreId($org));
        $first = $this->setPin($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $second = $this->setPin($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]), '4713');

        $this->onTill($token)->postJson('/api/v1/auth/pin', ['user_id' => $first->id, 'pin' => '2580'])->assertOk();
        $this->assertAuthenticatedAs($first, 'web');

        $this->onTill($token)->postJson('/api/v1/auth/pin', ['user_id' => $second->id, 'pin' => '4713'])
            ->assertOk()->assertJsonPath('data.user.id', $second->id);
        $this->assertAuthenticatedAs($second, 'web');
        $this->assertSame($second->id, Auth::guard('web')->id());

        // A wrong PIN of the next cashier leaves the current one signed in.
        $this->onTill($token)->postJson('/api/v1/auth/pin', ['user_id' => $first->id, 'pin' => '1357'])->assertStatus(422);
        $this->assertAuthenticatedAs($second, 'web');
    }

    public function test_the_signed_in_user_unlocks_the_screen_with_their_pin(): void
    {
        ['organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $this->actingAsUser($cashier);

        $this->postJson('/api/v1/auth/pin/verify', ['pin' => '2580'])->assertStatus(422)->assertJsonPath('error.code', 'PIN_NOT_SET');

        $this->setPin($cashier);
        $this->postJson('/api/v1/auth/pin/verify', ['pin' => '2580'])->assertNoContent();
        $this->postJson('/api/v1/auth/pin/verify', ['pin' => '0000'])->assertStatus(422)
            ->assertJsonPath('error.code', 'PIN_INVALID')->assertJsonPath('error.details.attempts_left', 4);
        $this->postJson('/api/v1/auth/pin/verify', ['pin' => '2580'])->assertNoContent();
        $this->assertSame(0, (int) $cashier->fresh()->pin_failed_count);

        foreach (range(1, 4) as $i) {
            $this->postJson('/api/v1/auth/pin/verify', ['pin' => '0000'])->assertStatus(422);
        }
        $this->postJson('/api/v1/auth/pin/verify', ['pin' => '0000'])->assertStatus(423)->assertJsonPath('error.code', 'PIN_LOCKED');
        $this->postJson('/api/v1/auth/pin/verify', ['pin' => '2580'])->assertStatus(423);

        // Setting a new PIN ends the lockout. (10 checks a minute per user.)
        $this->setPin($cashier, '3691');
        $this->travel(61)->seconds();
        $this->postJson('/api/v1/auth/pin/verify', ['pin' => '3691'])->assertNoContent();

        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/auth/pin/verify', ['pin' => '3691'])->assertUnauthorized();
    }

    public function test_pin_sign_in_is_throttled_per_till_and_per_user(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $token = $this->tillToken($org, $admin, $this->mainStoreId($org));
        $cashier = $this->setPin($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $other = $this->setPin($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]), '4713');

        foreach (range(1, 10) as $i) {
            $this->onTill($token)->postJson('/api/v1/auth/pin', ['user_id' => $i % 2 ? $cashier->id : $other->id, 'pin' => $i % 2 ? '2580' : '4713'])->assertOk();
        }
        $this->onTill($token)->postJson('/api/v1/auth/pin', ['user_id' => $cashier->id, 'pin' => '2580'])->assertStatus(429);

        // Per user, across tills.
        $second = $this->tillToken($org, $admin, $this->mainStoreId($org), 'Till 2');
        $third = $this->tillToken($org, $admin, $this->mainStoreId($org), 'Till 3');
        $this->onTill($second)->postJson('/api/v1/auth/pin', ['user_id' => $cashier->id, 'pin' => '2580'])->assertOk();
        foreach (range(1, 4) as $i) {
            $this->onTill($second)->postJson('/api/v1/auth/pin', ['user_id' => $cashier->id, 'pin' => '2580'])->assertOk();
        }
        $this->onTill($third)->postJson('/api/v1/auth/pin', ['user_id' => $cashier->id, 'pin' => '2580'])->assertStatus(429);
        $this->onTill($third)->postJson('/api/v1/auth/pin', ['user_id' => $other->id, 'pin' => '4713'])->assertOk();
    }

    private function assertPinsNeverLogged(): void
    {
        $logged = AuditLog::query()->withoutGlobalScopes()->get()
            ->map(fn ($a) => json_encode([$a->old_values, $a->new_values, $a->context]))
            ->implode(' ');
        foreach (['"pin":', 'pin_hash', '$2y$'] as $secret) {
            $this->assertStringNotContainsString($secret, $logged);
        }
    }
}
