<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * T2: the demo gallery — GET /api/v1/demo-stores and the /demos page — on any host, only
 * while `storefront.demo_gallery` is on and never in production. (The three seeded demo
 * stores are covered by tests/Feature/DemoThemesSeederTest.)
 */
class DemoGalleryTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private string $shell;

    protected function setUp(): void
    {
        parent::setUp();
        $this->shell = (string) tempnam(sys_get_temp_dir(), 'shell');
        file_put_contents($this->shell, '<!doctype html><html lang="en"><head><title>Storefront</title></head><body><div id="root"></div></body></html>');
        config(['storefront.shell_path' => $this->shell, 'storefront.demo_gallery' => false]);
    }

    protected function tearDown(): void
    {
        @unlink($this->shell);
        parent::tearDown();
    }

    public function test_the_gallery_is_not_found_while_disabled(): void
    {
        $this->getJson('http://platform.test/api/v1/demo-stores')->assertNotFound()->assertJsonPath('error.code', 'NOT_FOUND');
        $this->get('http://platform.test/demos')->assertNotFound();
    }

    public function test_the_gallery_is_never_on_in_production(): void
    {
        config(['storefront.demo_gallery' => true]);
        $this->app->detectEnvironment(fn () => 'production');

        $this->getJson('http://platform.test/api/v1/demo-stores')->assertNotFound();
        $this->get('http://platform.test/demos')->assertNotFound();
    }

    public function test_it_lists_open_demo_stores_in_configured_order(): void
    {
        config(['storefront.demo_gallery' => true, 'storefront.demo_hosts' => ['missing.test', 'closed.test', 'berry.test']]);
        $this->assertSame([], $this->getJson('http://platform.test/api/v1/demo-stores')->assertOk()->json('data'));

        // An open store on a demo host, a closed one on another, an open one that is not a demo.
        $berry = $this->openStore('Berry Kids', 'berry.test');
        $this->listCategory($this->category($berry['organization'], 'Clothes'));
        $closed = $this->provisionTenant('Closed Shop');
        $this->actingAsUser($closed['admin']);
        $this->postJson('/api/v1/storefront/domains', ['host' => 'closed.test'])->assertCreated();
        $this->openStore('Other Shop', 'other.test');
        $this->app['auth']->forgetGuards();

        $this->assertSame([[
            'host' => 'berry.test',
            'name' => 'Berry Kids',
            'preset' => 'default',
            'tagline' => null,
            'colors' => ['primary' => '#f59e0b', 'accent' => '#6f55c2', 'canvas' => '#f3f7fa'],
            'heading_font' => 'baloo',
            'image_url' => null,
            'product_count' => 0,
            'category_names' => ['Clothes'],
        ]], $this->getJson('http://platform.test/api/v1/demo-stores')->assertOk()->json('data'));
    }

    public function test_the_demos_page_is_served_on_any_host_while_enabled(): void
    {
        config(['storefront.demo_gallery' => true]);

        // A host without a store.
        $page = $this->get('http://platform.test/demos')->assertOk()->assertHeader('X-Robots-Tag', 'noindex');
        $html = (string) $page->getContent();
        $this->assertStringContainsString('<title>Online store demos</title>', $html);
        $this->assertStringContainsString('<meta name="robots" content="noindex, nofollow">', $html);
        $this->assertStringNotContainsString('storefront-bootstrap', $html);
        $this->assertStringContainsString('<div id="root"></div>', $html);
        $this->assertEmpty($page->headers->getCookies());

        // A store's host serves the same page, not the store's 404.
        $this->openStore('Berry Kids', 'berry.test');
        $this->get('http://berry.test/demos')->assertOk()->assertSee('<title>Online store demos</title>', false);
        $this->get('http://platform.test/demos/extra')->assertNotFound();
    }
}
