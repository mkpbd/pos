<?php

namespace App\Modules\CustomerAccounts\Tests\Concerns;

use Illuminate\Testing\TestResponse;

/**
 * A browser for storefront tests: requests carry the cookies earlier responses set (like a
 * real browser) and the guards are forgotten before each request, so every request
 * authenticates from its session alone. Use with InteractsWithTenancy.
 */
trait ActsAsShopper
{
    /** @var array<string, string> cookie name => value as the browser holds it (encrypted) */
    protected array $jar = [];

    /**
     * @param  array<string, mixed>  $data
     * @param  array<string, string>  $headers
     */
    protected function browse(string $method, string $url, array $data = [], array $headers = []): TestResponse
    {
        $this->app['auth']->forgetGuards();
        $this->unencryptedCookies = $this->jar;
        $this->defaultCookies = [];
        // JSON test requests only carry cookies "with credentials".
        $this->withCredentials = true;

        $response = $this->json($method, $url, $data, $headers);

        foreach ($response->headers->getCookies() as $cookie) {
            // Expiry against the test clock (travelTo), not the wall clock Cookie::isCleared() reads.
            $expired = $cookie->getExpiresTime() !== 0 && $cookie->getExpiresTime() < now()->getTimestamp();
            if ($expired || (string) $cookie->getValue() === '') {
                unset($this->jar[$cookie->getName()]);
            } else {
                $this->jar[$cookie->getName()] = (string) $cookie->getValue();
            }
        }
        $this->unencryptedCookies = [];

        return $response;
    }

    protected function clearBrowser(): void
    {
        $this->jar = [];
        $this->app['auth']->forgetGuards();
        $this->app['session']->driver()->flush();
    }

    /**
     * @return array<string, mixed> the response data (customer + merge)
     */
    protected function registerShopper(string $host, string $email = 'shopper@example.test', string $password = 'secret-pass1', array $extra = []): array
    {
        return $this->browse('POST', "http://{$host}/api/v1/store/account/register", $extra + [
            'name' => 'Rina Akter',
            'email' => $email,
            'password' => $password,
            'password_confirmation' => $password,
        ])->assertCreated()->json('data');
    }
}
