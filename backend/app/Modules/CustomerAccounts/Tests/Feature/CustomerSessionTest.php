<?php

namespace App\Modules\CustomerAccounts\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Cookie\CookieValuePrefix;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * ADR-002 (customers are never staff and vice versa, one browser may hold both), host
 * isolation of accounts and carts, and sessions + CSRF on storefront hosts that are not
 * Sanctum-stateful.
 */
class CustomerSessionTest extends TestCase
{
    use ActsAsShopper, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        config(['pos.auth_rate_limit' => 100]);
    }

    /**
     * A store served on the local (Sanctum-stateful) host, where staff and shoppers share a browser.
     */
    private function localStore(): array
    {
        $tenant = $this->openStore('Berry Kids', 'berry.test');
        config(['storefront.default_host' => 'berry.test']);
        $this->asVisitor();

        return $tenant;
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function spa(string $method, string $path, array $data = []): TestResponse
    {
        return $this->browse($method, 'http://localhost'.$path, $data, $this->spaHeaders());
    }

    private function staffLogin(string $email): void
    {
        $this->spa('POST', '/api/v1/auth/login', ['email' => $email, 'password' => 'password1'])->assertOk();
    }

    private function shopperRegister(): void
    {
        $this->spa('POST', '/api/v1/store/account/register', [
            'name' => 'Rina', 'email' => 'rina@example.test', 'password' => 'secret-pass1', 'password_confirmation' => 'secret-pass1',
        ])->assertCreated();
    }

    public function test_a_customer_session_never_authenticates_staff_routes(): void
    {
        $this->localStore();
        $this->shopperRegister();

        $this->spa('GET', '/api/v1/store/account/me')->assertOk()->assertJsonPath('data.email', 'rina@example.test');
        $this->spa('GET', '/api/v1/auth/me')->assertUnauthorized();
        $this->spa('GET', '/api/v1/customers')->assertUnauthorized();
    }

    public function test_a_staff_session_is_not_a_customer(): void
    {
        ['admin' => $admin] = $this->localStore();
        $this->staffLogin($admin->email);

        $this->spa('GET', '/api/v1/auth/me')->assertOk();
        $this->spa('GET', '/api/v1/store/account/me')->assertOk()->assertJsonPath('data', null);
        $this->spa('GET', '/api/v1/store/account/profile')->assertUnauthorized()->assertJsonPath('error.code', 'UNAUTHENTICATED');
        $this->spa('GET', '/api/v1/store/wishlist')->assertUnauthorized();
    }

    public function test_customer_sign_out_keeps_the_staff_session_of_the_same_browser(): void
    {
        ['admin' => $admin] = $this->localStore();
        $this->staffLogin($admin->email);
        $this->shopperRegister();
        $this->spa('GET', '/api/v1/auth/me')->assertOk()->assertJsonPath('data.user.email', $admin->email);

        $this->spa('POST', '/api/v1/store/account/logout')->assertNoContent();

        $this->spa('GET', '/api/v1/store/account/me')->assertOk()->assertJsonPath('data', null);
        $this->spa('GET', '/api/v1/auth/me')->assertOk()->assertJsonPath('data.user.email', $admin->email);
    }

    public function test_sign_in_regenerates_the_session_id(): void
    {
        $this->openStore('Berry Kids', 'shop.example.test');
        $this->asVisitor();
        $this->registerShopper('shop.example.test', 'rina@example.test');
        $this->browse('POST', 'http://shop.example.test/api/v1/store/account/logout')->assertNoContent();

        $this->browse('GET', 'http://shop.example.test/api/v1/store/account/me')->assertOk();
        $before = $this->app['session']->driver()->getId();
        $this->assertSame($before, $this->sessionIdFromJar());

        $this->browse('POST', 'http://shop.example.test/api/v1/store/account/login', ['email' => 'rina@example.test', 'password' => 'secret-pass1'])->assertOk();
        $after = $this->app['session']->driver()->getId();

        $this->assertNotSame($before, $after);
        $this->assertSame($after, $this->sessionIdFromJar());
    }

    public function test_an_account_of_one_store_is_anonymous_on_another_store(): void
    {
        $this->openStore('Berry Kids', 'berry.example.test');
        $this->openStore('Tiny Toes', 'tiny.example.test');
        $this->asVisitor();
        $this->registerShopper('berry.example.test', 'rina@example.test');
        $this->browse('GET', 'http://berry.example.test/api/v1/store/account/me')->assertJsonPath('data.email', 'rina@example.test');

        // The same session cookie on the other store's host.
        $this->browse('GET', 'http://tiny.example.test/api/v1/store/account/me')->assertOk()->assertJsonPath('data', null);
        $this->browse('GET', 'http://tiny.example.test/api/v1/store/account/profile')->assertUnauthorized();
        $this->browse('POST', 'http://tiny.example.test/api/v1/store/account/login', ['email' => 'rina@example.test', 'password' => 'secret-pass1'])
            ->assertStatus(422)->assertJsonPath('error.code', 'INVALID_CREDENTIALS');

        // Still signed in at home.
        $this->browse('GET', 'http://berry.example.test/api/v1/store/account/me')->assertJsonPath('data.email', 'rina@example.test');
    }

    public function test_a_storefront_host_that_is_not_stateful_gets_sessions_and_csrf_protection(): void
    {
        $this->openStore('Berry Kids', 'shop.example.test');
        $this->asVisitor();
        $this->assertNotContains('shop.example.test', config('sanctum.stateful'));

        // Run the real CSRF middleware (it is skipped while the environment is "testing").
        $this->app->instance('env', 'local');
        try {
            $me = $this->browse('GET', 'http://shop.example.test/api/v1/store/account/me')->assertOk();
            $this->assertNotNull($me->getCookie('XSRF-TOKEN', false), 'XSRF-TOKEN cookie issued');
            $this->assertNotNull($me->getCookie(config('session.cookie'), false), 'session cookie issued');
            $this->assertTrue($me->getCookie(config('session.cookie'), false)->isHttpOnly());

            $payload = ['name' => 'Rina', 'email' => 'rina@example.test', 'password' => 'secret-pass1', 'password_confirmation' => 'secret-pass1'];
            $this->browse('POST', 'http://shop.example.test/api/v1/store/account/register', $payload)
                ->assertStatus(419)->assertJsonPath('error.code', 'CSRF_TOKEN_MISMATCH');
            $this->browse('POST', 'http://shop.example.test/api/v1/store/account/register', $payload, ['X-XSRF-TOKEN' => 'forged'])
                ->assertStatus(419);

            $this->browse('POST', 'http://shop.example.test/api/v1/store/account/register', $payload, ['X-XSRF-TOKEN' => $this->jar['XSRF-TOKEN']])
                ->assertCreated()->assertJsonPath('data.customer.email', 'rina@example.test');
            $this->browse('GET', 'http://shop.example.test/api/v1/store/account/me')->assertJsonPath('data.email', 'rina@example.test');

            // Sign-out rotates the CSRF token: the old one no longer works.
            $old = $this->jar['XSRF-TOKEN'];
            $this->browse('POST', 'http://shop.example.test/api/v1/store/account/logout', [], ['X-XSRF-TOKEN' => $old])->assertNoContent();
            $this->browse('POST', 'http://shop.example.test/api/v1/store/account/login', ['email' => 'rina@example.test', 'password' => 'secret-pass1'], ['X-XSRF-TOKEN' => $old])
                ->assertStatus(419);
            $this->browse('POST', 'http://shop.example.test/api/v1/store/account/login', ['email' => 'rina@example.test', 'password' => 'secret-pass1'], ['X-XSRF-TOKEN' => $this->jar['XSRF-TOKEN']])
                ->assertOk();
        } finally {
            $this->app->instance('env', 'testing');
        }
    }

    public function test_bootstrap_starts_the_session_and_keeps_conditional_requests(): void
    {
        $this->openStore('Berry Kids', 'shop.example.test');
        $this->asVisitor();

        $first = $this->browse('GET', 'http://shop.example.test/api/v1/store/bootstrap')->assertOk();
        $this->assertNotNull($first->getCookie('XSRF-TOKEN', false));
        $etag = $first->headers->get('ETag');

        $this->browse('GET', 'http://shop.example.test/api/v1/store/bootstrap', [], ['If-None-Match' => $etag])->assertStatus(304);
        $this->registerShopper('shop.example.test');
        // Signing in does not change the shared store payload.
        $this->browse('GET', 'http://shop.example.test/api/v1/store/bootstrap', [], ['If-None-Match' => $etag])->assertStatus(304);
    }

    private function sessionIdFromJar(): string
    {
        return CookieValuePrefix::remove(decrypt($this->jar[config('session.cookie')], false));
    }
}
