<?php

namespace App\Modules\Authentication\Tests\Feature;

use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DeviceTokenTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    public function test_device_can_obtain_and_use_a_bearer_token(): void
    {
        ['admin' => $admin] = $this->provisionTenant();

        $response = $this->postJson('/api/v1/auth/tokens', [
            'email' => $admin->email, 'password' => 'password1', 'device_name' => 'Counter 1',
        ]);

        $response->assertCreated()->assertJsonPath('data.token_type', 'Bearer');
        $this->assertNotNull($response->json('data.expires_at'));
        $token = $response->json('data.token');

        $this->withToken($token)->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.user.id', $admin->id);
        $this->withToken($token)->getJson('/api/v1/auth/tokens')
            ->assertOk()
            ->assertJsonPath('data.0.name', 'Counter 1')
            ->assertJsonPath('data.0.is_current', true);
        $this->assertDatabaseHas('login_activities', ['user_id' => $admin->id, 'channel' => 'token', 'succeeded' => true]);
    }

    public function test_logout_with_a_token_revokes_only_that_token(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $first = $admin->createToken('a')->plainTextToken;
        $admin->createToken('b');

        $this->withToken($first)->postJson('/api/v1/auth/logout')->assertNoContent();

        $this->assertSame(['b'], $admin->tokens()->pluck('name')->all());
    }

    public function test_user_can_revoke_own_tokens_but_not_others(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $other = $this->provisionTenant('Other Co')['admin'];
        $mine = $admin->createToken('tablet')->accessToken;
        $theirs = $other->createToken('tablet')->accessToken;

        $this->actingAsUser($admin);
        $this->deleteJson("/api/v1/auth/tokens/{$theirs->id}")->assertNotFound();
        $this->deleteJson("/api/v1/auth/tokens/{$mine->id}")->assertNoContent();

        $this->assertDatabaseMissing('personal_access_tokens', ['id' => $mine->id]);
        $this->assertDatabaseHas('personal_access_tokens', ['id' => $theirs->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.token_revoked', 'organization_id' => $org->id]);
    }

    public function test_invalid_credentials_do_not_issue_a_token(): void
    {
        ['admin' => $admin] = $this->provisionTenant();

        $this->postJson('/api/v1/auth/tokens', ['email' => $admin->email, 'password' => 'bad-pass1', 'device_name' => 'x'])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'INVALID_CREDENTIALS');

        $this->assertSame(0, $admin->tokens()->count());
    }
}
