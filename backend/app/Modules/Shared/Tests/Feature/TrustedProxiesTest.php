<?php

namespace App\Modules\Shared\Tests\Feature;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class TrustedProxiesTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Route::middleware('api')->get('api/v1/_test/scheme', fn (Request $request) => [
            'secure' => $request->isSecure(),
            'ip' => $request->ip(),
        ]);
    }

    private function viaProxy(): array
    {
        return $this->withServerVariables(['REMOTE_ADDR' => '10.0.0.5'])
            ->withHeaders(['X-Forwarded-Proto' => 'https', 'X-Forwarded-For' => '203.0.113.7'])
            ->getJson('/api/v1/_test/scheme')
            ->assertOk()
            ->json();
    }

    public function test_forwarded_headers_are_ignored_by_default(): void
    {
        config(['trustedproxy.proxies' => null]);

        $this->assertSame(['secure' => false, 'ip' => '10.0.0.5'], $this->viaProxy());
    }

    public function test_a_configured_proxy_supplies_scheme_and_client_ip(): void
    {
        config(['trustedproxy.proxies' => ['10.0.0.0/8']]);

        $this->assertSame(['secure' => true, 'ip' => '203.0.113.7'], $this->viaProxy());
    }
}
