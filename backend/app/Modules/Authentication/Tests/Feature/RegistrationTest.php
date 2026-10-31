<?php

namespace App\Modules\Authentication\Tests\Feature;

use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RegistrationTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @return array<string, string>
     */
    private function payload(array $overrides = []): array
    {
        return array_merge([
            'organization_name' => 'Corner Shop',
            'name' => 'Rahim Uddin',
            'email' => 'Rahim@Corner.test',
            'password' => 'secret123',
            'password_confirmation' => 'secret123',
        ], $overrides);
    }

    private function spa(): static
    {
        return $this->withHeaders(['Referer' => 'http://'.array_values(array_filter(config('sanctum.stateful')))[0]]);
    }

    public function test_sign_up_provisions_a_ready_to_trade_organization(): void
    {
        $response = $this->spa()->postJson('/api/v1/auth/register', $this->payload(['branch_name' => 'Mirpur']));

        $response->assertCreated()
            ->assertJsonPath('data.user.email', 'rahim@corner.test')
            ->assertJsonPath('data.organization.name', 'Corner Shop')
            ->assertJsonPath('data.organization.slug', 'corner-shop')
            ->assertJsonPath('data.organization.base_currency', config('pos.default_currency'))
            ->assertJsonPath('data.roles.0.system_key', SystemRole::OrganizationAdmin->value)
            ->assertJsonPath('data.branches.0.name', 'Mirpur');

        $orgId = $response->json('data.organization.id');
        $this->assertDatabaseHas('branches', ['organization_id' => $orgId, 'code' => 'MAIN']);
        $this->assertDatabaseHas('stores', ['organization_id' => $orgId, 'code' => 'MAIN', 'type' => 'store']);
        $this->assertDatabaseCount('roles', count(SystemRole::cases()));
        $this->assertDatabaseHas('audit_logs', ['organization_id' => $orgId, 'action' => 'organization.provisioned']);
        $this->assertAuthenticated('web');
    }

    public function test_duplicate_email_is_rejected(): void
    {
        $this->spa()->postJson('/api/v1/auth/register', $this->payload())->assertCreated();
        $this->app['auth']->guard('web')->logout();

        $this->spa()->postJson('/api/v1/auth/register', $this->payload(['organization_name' => 'Another', 'email' => 'rahim@corner.test']))
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'VALIDATION_FAILED')
            ->assertJsonStructure(['error' => ['details' => ['email']]]);
    }

    public function test_slug_collisions_get_a_suffix(): void
    {
        $this->spa()->postJson('/api/v1/auth/register', $this->payload())->assertCreated();
        $this->app['auth']->guard('web')->logout();

        $second = $this->spa()->postJson('/api/v1/auth/register', $this->payload(['email' => 'other@corner.test']));

        $second->assertCreated();
        $this->assertMatchesRegularExpression('/^corner-shop-[a-z0-9]{5}$/', $second->json('data.organization.slug'));
    }

    public function test_password_must_be_confirmed(): void
    {
        $this->spa()->postJson('/api/v1/auth/register', $this->payload(['password_confirmation' => 'different1']))
            ->assertStatus(422)
            ->assertJsonStructure(['error' => ['details' => ['password']]]);

        $this->assertDatabaseCount('organizations', 0);
    }

    public function test_registration_can_be_disabled(): void
    {
        config(['pos.registration_enabled' => false]);

        $this->spa()->postJson('/api/v1/auth/register', $this->payload())->assertNotFound();
        $this->assertDatabaseCount('organizations', 0);
    }
}
