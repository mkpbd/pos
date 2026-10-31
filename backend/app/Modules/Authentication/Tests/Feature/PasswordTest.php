<?php

namespace App\Modules\Authentication\Tests\Feature;

use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

class PasswordTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    public function test_forgot_password_sends_a_spa_link_without_revealing_accounts(): void
    {
        Notification::fake();
        ['admin' => $admin] = $this->provisionTenant();

        $known = $this->postJson('/api/v1/auth/forgot-password', ['email' => $admin->email]);
        $unknown = $this->postJson('/api/v1/auth/forgot-password', ['email' => 'nobody@example.test']);

        $known->assertOk();
        $unknown->assertOk();
        $this->assertSame($known->json('data'), $unknown->json('data'));

        Notification::assertSentTo($admin, ResetPassword::class, function (ResetPassword $notification) use ($admin) {
            $url = $notification->toMail($admin)->actionUrl;

            return str_starts_with($url, config('pos.frontend_url').'/admin/reset-password?token=');
        });
    }

    public function test_reset_with_valid_token_changes_password_and_revokes_tokens(): void
    {
        Notification::fake();
        ['admin' => $admin] = $this->provisionTenant();
        $admin->createToken('old-device');

        $this->postJson('/api/v1/auth/forgot-password', ['email' => $admin->email]);
        $token = null;
        Notification::assertSentTo($admin, ResetPassword::class, function (ResetPassword $n) use (&$token) {
            $token = $n->token;

            return true;
        });

        $this->postJson('/api/v1/auth/reset-password', [
            'token' => $token,
            'email' => $admin->email,
            'password' => 'brand-new-9',
            'password_confirmation' => 'brand-new-9',
        ])->assertOk();

        $this->assertTrue(Hash::check('brand-new-9', $admin->fresh()->password));
        $this->assertSame(0, $admin->tokens()->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.password_reset', 'subject_id' => $admin->id]);
    }

    public function test_reset_with_invalid_token_fails(): void
    {
        ['admin' => $admin] = $this->provisionTenant();

        $this->postJson('/api/v1/auth/reset-password', [
            'token' => 'forged',
            'email' => $admin->email,
            'password' => 'brand-new-9',
            'password_confirmation' => 'brand-new-9',
        ])->assertStatus(422)->assertJsonPath('error.code', 'INVALID_RESET_TOKEN');

        $this->assertTrue(Hash::check('password1', $admin->fresh()->password));
    }

    public function test_change_password_requires_current_and_signs_out_other_devices(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $current = $admin->createToken('this-device');
        $admin->createToken('other-device');

        $this->withToken($current->plainTextToken)->putJson('/api/v1/auth/password', [
            'current_password' => 'wrong-one1',
            'password' => 'brand-new-9',
            'password_confirmation' => 'brand-new-9',
        ])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['current_password']]]);

        $this->withToken($current->plainTextToken)->putJson('/api/v1/auth/password', [
            'current_password' => 'password1',
            'password' => 'brand-new-9',
            'password_confirmation' => 'brand-new-9',
        ])->assertNoContent();

        $this->assertTrue(Hash::check('brand-new-9', $admin->fresh()->password));
        $this->assertSame(['this-device'], $admin->tokens()->pluck('name')->all());
    }
}
