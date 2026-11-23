<?php

namespace App\Modules\Shared\Tests\Feature;

use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * G1a: security headers on Laravel responses.
 */
class SecurityHeadersTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    public function test_api_responses_are_never_framed_and_load_nothing(): void
    {
        $this->getJson('/api/v1/auth/options')
            ->assertOk()
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
            ->assertHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
            ->assertHeader('X-Frame-Options', 'DENY')
            ->assertHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
            ->assertHeaderMissing('Strict-Transport-Security');

        // Error responses too.
        $this->getJson('/api/v1/users')->assertUnauthorized()->assertHeader('X-Frame-Options', 'DENY')->assertHeader('X-Content-Type-Options', 'nosniff');
    }

    public function test_storefront_pages_may_be_framed_only_by_the_store_and_the_admin_app(): void
    {
        config(['pos.frontend_url' => 'https://admin.example.com:8443/']);
        $shell = tempnam(sys_get_temp_dir(), 'shell');
        file_put_contents($shell, '<!doctype html><html><head><title>Storefront</title></head><body></body></html>');
        config(['storefront.shell_path' => $shell]);

        $tenant = $this->provisionTenant('Berry Kids');
        $this->actingAsUser($tenant['admin']);
        $this->postJson('/api/v1/storefront/domains', ['host' => 'berry.test'])->assertCreated();
        $this->patchJson('/api/v1/storefront/settings', ['site_name' => 'Berry Kids', 'is_enabled' => true])->assertOk();
        $this->app['auth']->forgetGuards();

        $this->get('http://berry.test/')
            ->assertOk()
            ->assertHeader('Content-Security-Policy', "frame-ancestors 'self' https://admin.example.com:8443")
            ->assertHeaderMissing('X-Frame-Options')
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
            ->assertHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

        // Non-HTML responses get no CSP.
        $this->get('http://berry.test/robots.txt')->assertOk()->assertHeaderMissing('Content-Security-Policy')->assertHeader('X-Content-Type-Options', 'nosniff');
    }

    public function test_hsts_only_over_https_and_when_enabled(): void
    {
        $this->get('https://localhost/api/v1/auth/options')
            ->assertHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        $this->get('http://localhost/api/v1/auth/options')->assertHeaderMissing('Strict-Transport-Security');

        config(['pos.security.hsts' => false]);
        $this->get('https://localhost/api/v1/auth/options')->assertHeaderMissing('Strict-Transport-Security');
    }

    public function test_headers_set_by_a_route_are_not_overwritten(): void
    {
        Route::get('api/g1a-header-probe', fn () => response()->json(['ok' => true], 200, [
            'X-Frame-Options' => 'SAMEORIGIN',
            'Referrer-Policy' => 'no-referrer',
            'Content-Security-Policy' => "default-src 'self'",
        ]));

        $this->getJson('/api/g1a-header-probe')
            ->assertOk()
            ->assertHeader('X-Frame-Options', 'SAMEORIGIN')
            ->assertHeader('Referrer-Policy', 'no-referrer')
            ->assertHeader('Content-Security-Policy', "default-src 'self'")
            ->assertHeader('X-Content-Type-Options', 'nosniff');
    }
}
