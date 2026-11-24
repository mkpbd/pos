<?php

namespace App\Modules\Marketing\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * BD1c: the store's pixels reach the storefront — the bootstrap's `tracking` (public ids only)
 * and the pasted code written raw into the shell on public pages, never in a staff preview,
 * never on another store.
 */
class StorefrontTrackingTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const HEAD = '<script>window.headTag = "a & b";</script>';

    private const BODY = '<noscript><img height="1" width="1" src="https://www.facebook.com/tr?id=123456789012345&ev=PageView"></noscript>';

    private string $shell;

    /** @var array<string, mixed> */
    private array $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->shell = (string) tempnam(sys_get_temp_dir(), 'shell');
        file_put_contents($this->shell, "<!doctype html><html><head><title>Storefront</title></head><body><div id=\"root\"></div>\n</body></html>");
        config(['storefront.shell_path' => $this->shell, 'app.url' => 'https://admin.example.test']);
        $this->tenant = $this->openStore('Berry Kids', 'berry.test');
    }

    protected function tearDown(): void
    {
        @unlink($this->shell);
        parent::tearDown();
    }

    private function configure(): void
    {
        $this->actingAsUser($this->tenant['admin']);
        $this->patchJson('/api/v1/marketing/tracking', [
            'meta_pixel_id' => '123456789012345',
            'meta_capi_enabled' => true,
            'meta_capi_token' => 'SECRET-TOKEN-XYZ',
            'ga4_measurement_id' => 'G-ABCDEF1234',
            'head_code' => self::HEAD,
            'body_code' => self::BODY,
        ])->assertOk();
    }

    /**
     * @return array<string, mixed>
     */
    private function inlinedBootstrap(string $html): array
    {
        $this->assertSame(1, preg_match('#<script id="storefront-bootstrap" type="application/json">(.*?)</script>#s', $html, $m));

        return json_decode($m[1], true, flags: JSON_THROW_ON_ERROR);
    }

    public function test_the_bootstrap_carries_only_the_public_ids(): void
    {
        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()->assertJsonPath('data.tracking', null);

        $this->configure();
        $this->asVisitor();
        $response = $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk();
        $this->assertSame(['meta_pixel_id' => '123456789012345', 'ga4_measurement_id' => 'G-ABCDEF1234', 'tiktok_pixel_id' => null], $response->json('data.tracking'));
        $this->assertStringNotContainsString('SECRET-TOKEN-XYZ', $response->getContent());
        $this->assertStringNotContainsString('headTag', $response->getContent());

        // A staff draft preview never loads the pixels.
        $this->actingAsUser($this->tenant['admin']);
        $this->getJson('http://berry.test/api/v1/store/bootstrap?preview=draft')->assertOk()->assertJsonPath('data.tracking', null);
    }

    public function test_the_code_is_written_raw_into_public_pages(): void
    {
        $this->configure();
        $this->asVisitor();

        foreach (['/', '/checkout', '/order/WEB-000001', '/nope'] as $path) {
            $html = (string) $this->get('http://berry.test'.$path)->getContent();
            // Raw (not escaped), at the end of <head> and right before </body>.
            $this->assertStringContainsString(self::HEAD."\n  </head>", $html, $path);
            $this->assertStringContainsString(self::BODY."\n  </body>", $html, $path);
            $this->assertSame(1, substr_count($html, self::HEAD));
            $this->assertLessThan(strpos($html, self::HEAD), strpos($html, 'id="storefront-bootstrap"'));
            $this->assertSame('123456789012345', $this->inlinedBootstrap($html)['tracking']['meta_pixel_id']);
            $this->assertStringNotContainsString('SECRET-TOKEN-XYZ', $html);
        }
    }

    public function test_never_in_previews(): void
    {
        $this->configure();

        // Staff draft preview (the builder's preview) and a blog preview address.
        $this->actingAsUser($this->tenant['admin']);
        foreach (['/?preview=draft', '/blog/anything?preview=1'] as $url) {
            $html = (string) $this->get('http://berry.test'.$url)->getContent();
            $this->assertStringNotContainsString('headTag', $html, $url);
            $this->assertStringNotContainsString('facebook.com/tr', $html, $url);
            $this->assertNull($this->inlinedBootstrap($html)['tracking'], $url);
        }

        // A closed store's staff preview.
        $this->patchJson('/api/v1/storefront/settings', ['is_enabled' => false])->assertOk();
        $html = (string) $this->get('http://berry.test/')->assertOk()->getContent();
        $this->assertTrue($this->inlinedBootstrap($html)['preview']);
        $this->assertStringNotContainsString('headTag', $html);
        $this->assertNull($this->inlinedBootstrap($html)['tracking']);
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()->assertJsonPath('data.preview', true)->assertJsonPath('data.tracking', null);
    }

    public function test_another_store_never_gets_the_code(): void
    {
        $this->configure();
        $this->openStore('Other Shop', 'other.test');
        $this->asVisitor();

        $html = (string) $this->get('http://other.test/')->assertOk()->getContent();
        $this->assertStringNotContainsString('headTag', $html);
        $this->assertStringNotContainsString('facebook.com/tr', $html);
        $this->assertNull($this->inlinedBootstrap($html)['tracking']);
        $this->getJson('http://other.test/api/v1/store/bootstrap')->assertOk()->assertJsonPath('data.tracking', null);
    }
}
