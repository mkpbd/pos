<?php

namespace App\Modules\Shared\Tests\Feature;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use RuntimeException;
use Tests\TestCase;

class ApiErrorEnvelopeTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Route::prefix('api/v1/_test')->middleware('api')->group(function () {
            Route::get('ok', fn () => ApiResponse::success(['hello' => 'world']));
            Route::post('validate', fn (Request $r) => $r->validate(['name' => ['required', 'string']]));
            Route::get('unauthenticated', fn () => throw new AuthenticationException);
            Route::get('forbidden', fn () => throw new AuthorizationException);
            Route::get('rule', fn () => throw new BusinessRuleViolation('INSUFFICIENT_STOCK', 'Not enough stock.', ['available' => '2']));
            Route::get('boom', fn () => throw new RuntimeException('secret internals'));
        });
    }

    public function test_success_envelope_carries_request_id(): void
    {
        $response = $this->getJson('/api/v1/_test/ok');

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.hello', 'world');

        $this->assertNotEmpty($response->headers->get('X-Request-Id'));
        $response->assertJsonPath('meta.request_id', $response->headers->get('X-Request-Id'));
    }

    public function test_safe_client_request_id_is_propagated(): void
    {
        $this->getJson('/api/v1/_test/ok', ['X-Request-Id' => 'client-abc-12345'])
            ->assertHeader('X-Request-Id', 'client-abc-12345')
            ->assertJsonPath('meta.request_id', 'client-abc-12345');
    }

    public function test_unsafe_client_request_id_is_replaced(): void
    {
        $response = $this->getJson('/api/v1/_test/ok', ['X-Request-Id' => '<script>alert(1)</script>']);

        $this->assertNotSame('<script>alert(1)</script>', $response->headers->get('X-Request-Id'));
    }

    public function test_validation_errors(): void
    {
        $this->postJson('/api/v1/_test/validate', [])
            ->assertStatus(422)
            ->assertJsonPath('success', false)
            ->assertJsonPath('error.code', 'VALIDATION_FAILED')
            ->assertJsonStructure(['error' => ['details' => ['name']]]);
    }

    public function test_unauthenticated(): void
    {
        $this->getJson('/api/v1/_test/unauthenticated')
            ->assertStatus(401)
            ->assertJsonPath('error.code', 'UNAUTHENTICATED');
    }

    public function test_forbidden(): void
    {
        $this->getJson('/api/v1/_test/forbidden')
            ->assertStatus(403)
            ->assertJsonPath('error.code', 'FORBIDDEN');
    }

    public function test_business_rule_violation(): void
    {
        $this->getJson('/api/v1/_test/rule')
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'INSUFFICIENT_STOCK')
            ->assertJsonPath('error.details.available', '2');
    }

    public function test_unknown_route_returns_not_found_envelope(): void
    {
        $this->getJson('/api/v1/does-not-exist')
            ->assertStatus(404)
            ->assertJsonPath('error.code', 'NOT_FOUND');
    }

    public function test_method_not_allowed(): void
    {
        $this->deleteJson('/api/v1/_test/ok')
            ->assertStatus(405)
            ->assertJsonPath('error.code', 'METHOD_NOT_ALLOWED');
    }

    public function test_server_errors_hide_internals_in_production_mode(): void
    {
        config(['app.debug' => false]);

        $response = $this->getJson('/api/v1/_test/boom');

        $response->assertStatus(500)->assertJsonPath('error.code', 'SERVER_ERROR');
        $this->assertStringNotContainsString('secret internals', $response->getContent());
    }
}
