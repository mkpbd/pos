<?php

namespace App\Modules\Authentication\Tests\Feature;

use App\Modules\Authentication\Tests\Concerns\InteractsWithTwoFactor;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Enums\UserStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * G1a: web sign-in and device tokens for accounts with two-factor sign-in.
 */
class TwoFactorSignInTest extends TestCase
{
    use InteractsWithTenancy, InteractsWithTwoFactor, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->freezeSecond();
    }

    public function test_password_alone_only_starts_a_challenge_and_a_valid_code_signs_in(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        ['secret' => $secret] = $this->enableTwoFactor($admin);

        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/login', ['email' => $admin->email, 'password' => 'password1', 'remember' => true])
            ->assertOk()
            ->assertJsonPath('data', ['two_factor_required' => true]);

        $this->assertGuest('web');
        $this->assertNull($admin->fresh()->last_login_at);
        $this->assertDatabaseMissing('login_activities', ['user_id' => $admin->id]);
        $this->withHeaders($this->spaHeaders())->getJson('/api/v1/auth/me')->assertUnauthorized();

        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/two-factor-challenge', ['code' => $this->totpCode($secret)])
            ->assertOk()
            ->assertJsonPath('data.user.id', $admin->id)
            ->assertJsonPath('data.two_factor', ['enabled' => true, 'required' => false, 'setup_required' => false]);

        $this->assertAuthenticatedAs($admin, 'web');
        $this->assertNotNull($admin->fresh()->last_login_at);
        $this->assertDatabaseHas('login_activities', ['user_id' => $admin->id, 'succeeded' => true, 'channel' => 'session']);
        $audit = $this->latestAudit('auth.login', $admin->id);
        $this->assertSame(['channel' => 'session', 'two_factor' => 'totp'], $audit);
        $this->withHeaders($this->spaHeaders())->getJson('/api/v1/auth/me')->assertOk();
    }

    public function test_wrong_code_is_refused_counted_and_five_wrong_codes_end_the_challenge(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        ['secret' => $secret] = $this->enableTwoFactor($admin);
        $this->login($admin->email);

        for ($i = 1; $i <= 5; $i++) {
            $this->withHeaders($this->spaHeaders())
                ->postJson('/api/v1/auth/two-factor-challenge', ['code' => $this->wrongTotpCode($secret)])
                ->assertStatus(422)
                ->assertJsonPath('error.code', 'INVALID_TWO_FACTOR_CODE');
        }

        $this->assertSame(5, $admin->fresh()->failed_login_count);
        $this->assertSame(5, $this->loginActivities($admin->id, 'invalid_two_factor'));

        // The challenge is gone: even the right code now needs a new sign-in (a minute later, past throttle:auth).
        $this->travel(61)->seconds();
        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/two-factor-challenge', ['code' => $this->totpCode($secret)])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'TWO_FACTOR_CHALLENGE_EXPIRED');
        $this->assertGuest('web');
    }

    public function test_challenge_expires_after_five_minutes(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        ['secret' => $secret] = $this->enableTwoFactor($admin);
        $this->login($admin->email);

        $this->travel(5)->minutes();
        $this->travel(1)->seconds();

        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/two-factor-challenge', ['code' => $this->totpCode($secret)])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'TWO_FACTOR_CHALLENGE_EXPIRED')
            ->assertJsonPath('error.message', 'Sign in again.');
        $this->assertGuest('web');
    }

    public function test_challenge_without_a_pending_sign_in_is_expired(): void
    {
        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/two-factor-challenge', ['code' => '123456'])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'TWO_FACTOR_CHALLENGE_EXPIRED');
    }

    public function test_challenge_needs_exactly_one_of_code_and_recovery_code(): void
    {
        $this->withHeaders($this->spaHeaders())->postJson('/api/v1/auth/two-factor-challenge', [])
            ->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
        $this->withHeaders($this->spaHeaders())->postJson('/api/v1/auth/two-factor-challenge', ['code' => '123456', 'recovery_code' => 'abcde-fghjk'])
            ->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
        $this->withHeaders($this->spaHeaders())->postJson('/api/v1/auth/two-factor-challenge', ['code' => '12345'])
            ->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
    }

    public function test_a_code_is_never_accepted_twice(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        ['secret' => $secret] = $this->enableTwoFactor($admin);
        $code = $this->totpCode($secret);

        $this->login($admin->email);
        $this->withHeaders($this->spaHeaders())->postJson('/api/v1/auth/two-factor-challenge', ['code' => $code])->assertOk();
        $this->withHeaders($this->spaHeaders())->postJson('/api/v1/auth/logout')->assertNoContent();

        $this->login($admin->email);
        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/two-factor-challenge', ['code' => $code])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'INVALID_TWO_FACTOR_CODE');

        // The code of the next time step works.
        $this->travel(30)->seconds();
        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/two-factor-challenge', ['code' => $this->totpCode($secret)])
            ->assertOk();
    }

    public function test_a_recovery_code_signs_in_once(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        ['recovery_codes' => $codes] = $this->enableTwoFactor($admin);

        $this->login($admin->email);
        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/two-factor-challenge', ['recovery_code' => strtoupper($codes[2])])
            ->assertOk()
            ->assertJsonPath('data.user.id', $admin->id);

        $this->assertCount(9, $admin->fresh()->two_factor_recovery_codes);
        $this->assertSame(['channel' => 'session', 'two_factor' => 'recovery_code'], $this->latestAudit('auth.login', $admin->id));
        $this->assertSame(['remaining' => 9], $this->latestAudit('auth.recovery_code_used', $admin->id));

        $this->withHeaders($this->spaHeaders())->postJson('/api/v1/auth/logout')->assertNoContent();
        $this->login($admin->email);
        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/two-factor-challenge', ['recovery_code' => $codes[2]])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'INVALID_TWO_FACTOR_CODE');
        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/two-factor-challenge', ['recovery_code' => $codes[3]])
            ->assertOk();
    }

    public function test_challenge_is_refused_when_the_account_was_deactivated_meanwhile(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        ['secret' => $secret] = $this->enableTwoFactor($admin);
        $this->login($admin->email);
        $admin->forceFill(['status' => UserStatus::Inactive])->save();

        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/two-factor-challenge', ['code' => $this->totpCode($secret)])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'ACCOUNT_INACTIVE');
        $this->assertGuest('web');
    }

    public function test_device_token_needs_a_second_factor(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        ['secret' => $secret, 'recovery_codes' => $codes] = $this->enableTwoFactor($admin);
        $body = ['email' => $admin->email, 'password' => 'password1', 'device_name' => 'Counter 1'];

        $this->postJson('/api/v1/auth/tokens', $body)
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'TWO_FACTOR_REQUIRED')
            ->assertJsonStructure(['error' => ['details' => ['code']]]);
        $this->assertSame(0, $admin->fresh()->failed_login_count);

        $this->postJson('/api/v1/auth/tokens', $body + ['code' => $this->wrongTotpCode($secret)])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'INVALID_TWO_FACTOR_CODE');
        $this->assertSame(1, $admin->fresh()->failed_login_count);
        $this->assertSame(1, $this->loginActivities($admin->id, 'invalid_two_factor'));
        $this->assertSame(0, $admin->tokens()->count());

        $this->postJson('/api/v1/auth/tokens', $body + ['code' => $this->totpCode($secret)])
            ->assertCreated()
            ->assertJsonPath('data.token_type', 'Bearer');
        $this->assertSame(0, $admin->fresh()->failed_login_count);
        $this->assertSame('totp', $this->latestAudit('auth.token_issued', $admin->id)['two_factor']);

        $this->postJson('/api/v1/auth/tokens', $body + ['recovery_code' => $codes[0]])->assertCreated();
        $this->postJson('/api/v1/auth/tokens', $body + ['recovery_code' => $codes[0]])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'INVALID_TWO_FACTOR_CODE');
        $this->assertSame(2, $admin->tokens()->count());
    }

    public function test_secrets_never_appear_in_sign_in_responses_or_the_audit_trail(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        ['secret' => $secret, 'recovery_codes' => $codes] = $this->enableTwoFactor($admin);
        $this->login($admin->email);
        $response = $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/two-factor-challenge', ['recovery_code' => $codes[0]])
            ->assertOk();

        $body = (string) $response->getContent();
        $this->assertStringNotContainsString($secret, $body);
        $this->assertStringNotContainsString('two_factor_secret', $body);
        $this->assertStringNotContainsString('recovery_codes', $body);
        $audit = json_encode(DB::table('audit_logs')->get());
        $this->assertStringNotContainsString($secret, (string) $audit);
        $this->assertStringNotContainsString($codes[0], (string) $audit);
    }

    private function login(string $email): void
    {
        $this->withHeaders($this->spaHeaders())
            ->postJson('/api/v1/auth/login', ['email' => $email, 'password' => 'password1'])
            ->assertOk()
            ->assertJsonPath('data.two_factor_required', true);
    }

    private function loginActivities(string $userId, string $reason): int
    {
        return DB::table('login_activities')->where('user_id', $userId)->where('failure_reason', $reason)->count();
    }

    /**
     * @return array<string, mixed>|null
     */
    private function latestAudit(string $action, string $subjectId): ?array
    {
        $context = DB::table('audit_logs')->where('action', $action)->where('subject_id', $subjectId)->orderByDesc('created_at')->orderByDesc('id')->value('context');

        return $context === null ? null : json_decode($context, true);
    }
}
