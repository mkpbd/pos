<?php

namespace App\Modules\System\Tests\Feature;

use Illuminate\Support\Facades\DB;
use RuntimeException;
use Tests\TestCase;

class HealthEndpointTest extends TestCase
{
    public function test_reports_ok_when_dependencies_are_up(): void
    {
        $this->getJson('/api/v1/health')
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.status', 'ok')
            ->assertJsonPath('data.checks.database', 'ok')
            ->assertJsonPath('data.checks.cache', 'ok');
    }

    public function test_reports_degraded_without_leaking_errors_when_database_is_down(): void
    {
        DB::shouldReceive('select')->andThrow(new RuntimeException('password authentication failed for user'));

        $response = $this->getJson('/api/v1/health');

        $response->assertStatus(503)
            ->assertJsonPath('data.status', 'degraded')
            ->assertJsonPath('data.checks.database', 'fail');
        $this->assertStringNotContainsString('password', $response->getContent());
    }
}
