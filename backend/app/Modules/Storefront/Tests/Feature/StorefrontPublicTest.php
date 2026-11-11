<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class StorefrontPublicTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    /**
     * An organization with a domain, a theme, menus and (optionally) an open store.
     *
     * @return array{organization: Organization, admin: User}
     */
    private function store(string $name, string $host, bool $open = true): array
    {
        $tenant = $this->provisionTenant($name);
        $this->actingAsUser($tenant['admin']);
        $this->postJson('/api/v1/storefront/domains', ['host' => $host])->assertCreated();
        $this->patchJson('/api/v1/storefront/settings', ['site_name' => $name, 'is_enabled' => $open])->assertOk();
        $main = $this->postJson('/api/v1/storefront/menus', ['name' => 'Main', 'location' => 'main'])->json('data.id');
        $this->putJson("/api/v1/storefront/menus/{$main}/items", ['items' => [
            ['label' => "{$name} Boys", 'url' => '/boys', 'children' => [['label' => 'Shirts', 'url' => '/boys/shirts']]],
            ['label' => 'Hidden', 'url' => '/hidden', 'is_visible' => false, 'children' => [['label' => 'Child of hidden', 'url' => '/x']]],
        ]])->assertOk();
        $this->app['auth']->forgetGuards();

        return $tenant;
    }

    public function test_bootstrap_resolves_the_organization_from_the_host(): void
    {
        $this->store('Berry Kids', 'berry.test');
        $this->store('Tiny Toes', 'tiny.test');

        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()
            ->assertJsonPath('data.store.name', 'Berry Kids')
            ->assertJsonPath('data.preview', false)
            ->assertJsonPath('data.theme.colors.primary', '#f59e0b')
            ->assertJsonPath('data.menus.main.items.0.label', 'Berry Kids Boys')
            ->assertJsonPath('data.menus.main.items.0.children.0.label', 'Shirts')
            // A hidden item hides its whole branch.
            ->assertJsonCount(1, 'data.menus.main.items');

        $this->getJson('http://TINY.test/api/v1/store/bootstrap')->assertOk()
            ->assertJsonPath('data.store.name', 'Tiny Toes')
            ->assertJsonPath('data.menus.main.items.0.label', 'Tiny Toes Boys');

        $this->getJson('http://unknown.test/api/v1/store/bootstrap')
            ->assertNotFound()->assertJsonPath('error.code', 'STOREFRONT_NOT_FOUND');
    }

    public function test_a_closed_store_is_hidden_except_for_its_own_staff_preview(): void
    {
        ['organization' => $org] = $this->store('Berry Kids', 'berry.test', open: false);
        ['admin' => $otherAdmin] = $this->store('Tiny Toes', 'tiny.test');
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);
        $manager = $this->createUserWithRole($org, SystemRole::OnlineStoreManager);

        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertNotFound();

        $this->actingAsUser($otherAdmin);
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertNotFound();

        $this->actingAsUser($cashier);
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertNotFound();

        $this->actingAsUser($manager);
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()->assertJsonPath('data.preview', true);
    }

    public function test_suspended_organizations_have_no_storefront(): void
    {
        ['organization' => $org] = $this->store('Berry Kids', 'berry.test');
        Organization::query()->whereKey($org->id)->update(['status' => 'suspended']);

        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertNotFound();
    }

    public function test_theme_media_and_announcement_schedule(): void
    {
        Storage::fake('public');
        ['admin' => $admin] = $this->store('Berry Kids', 'berry.test');
        $this->actingAsUser($admin);
        $logo = $this->post('/api/v1/media', ['file' => UploadedFile::fake()->image('logo.png', 400, 120), 'alt' => 'Berry Kids'], $this->spaHeaders())->json('data');
        $this->putJson('/api/v1/storefront/theme', [
            'logo_media_id' => $logo['id'],
            'announcement' => ['enabled' => true, 'text' => 'Eid sale', 'starts_at' => '2026-11-01T00:00:00+06:00', 'ends_at' => '2026-11-05T00:00:00+06:00'],
            'footer' => ['social' => ['facebook' => 'https://facebook.com/berrykids'], 'payment_logo_media_ids' => [$logo['id']]],
        ])->assertOk();
        $this->app['auth']->forgetGuards();

        Date::setTestNow('2026-10-31T12:00:00+06:00');
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()
            ->assertJsonPath('data.theme.logo.url', $logo['url'])
            ->assertJsonPath('data.theme.logo.alt', 'Berry Kids')
            ->assertJsonPath('data.theme.footer.social', ['facebook' => 'https://facebook.com/berrykids'])
            ->assertJsonPath('data.theme.footer.payment_logos.0.id', $logo['id'])
            ->assertJsonPath('data.theme.announcement', null);

        Date::setTestNow('2026-11-02T12:00:00+06:00');
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertJsonPath('data.theme.announcement.text', 'Eid sale');

        Date::setTestNow('2026-11-05T00:00:00+06:00');
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertJsonPath('data.theme.announcement', null);
    }

    public function test_bootstrap_supports_conditional_requests(): void
    {
        $this->store('Berry Kids', 'berry.test');

        $etag = $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()->headers->get('ETag');
        $this->assertNotEmpty($etag);

        $this->getJson('http://berry.test/api/v1/store/bootstrap', ['If-None-Match' => $etag])->assertStatus(304);
    }

    public function test_local_hosts_map_to_the_configured_default_storefront(): void
    {
        $this->store('Berry Kids', 'berry.test');
        config(['storefront.default_host' => 'berry.test']);

        $this->getJson('http://localhost/api/v1/store/bootstrap')->assertOk()->assertJsonPath('data.store.name', 'Berry Kids');
    }

    public function test_signed_in_staff_see_their_own_store_on_a_local_host(): void
    {
        $this->store('Berry Kids', 'berry.test');
        ['admin' => $admin] = $this->store('Tiny Toes', 'tiny.test');
        config(['storefront.default_host' => 'berry.test']);

        $this->actingAsUser($admin);
        $this->getJson('http://localhost/api/v1/store/bootstrap')->assertOk()->assertJsonPath('data.store.name', 'Tiny Toes');
        // A real host still decides the store, signed in or not.
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()->assertJsonPath('data.store.name', 'Berry Kids');
    }

    public function test_shell_serves_the_storefront_page_with_server_side_metadata(): void
    {
        $shell = tempnam(sys_get_temp_dir(), 'shell');
        file_put_contents($shell, '<!doctype html><html><head><title>Storefront</title><link rel="icon" href="/favicon.svg"></head><body><div id="root"></div></body></html>');
        config(['storefront.shell_path' => $shell]);

        ['admin' => $admin] = $this->store('Berry </script> Kids', 'berry.test');
        $this->actingAsUser($admin);
        $this->patchJson('/api/v1/storefront/settings', ['meta_description' => 'Clothes & toys "for" babies'])->assertOk();
        $this->app['auth']->forgetGuards();

        $html = $this->get('http://berry.test/')->assertOk()->assertHeader('X-Robots-Tag', 'all')->getContent();
        $this->assertStringContainsString('<title>Berry &lt;/script&gt; Kids</title>', $html);
        $this->assertStringContainsString('<meta name="description" content="Clothes &amp; toys &quot;for&quot; babies">', $html);
        $this->assertStringContainsString('<link rel="canonical" href="http://berry.test">', $html);
        // Organization + WebSite JSON-LD and the bootstrap payload; none can close its <script> element early.
        $this->assertSame(3, substr_count($html, '</script>'));
        $this->assertStringNotContainsString('</script> Kids', $html);
        $this->assertStringContainsString('<script id="storefront-bootstrap" type="application/json">', $html);

        $this->get('http://berry.test/no-such-page')->assertNotFound()->assertHeader('X-Robots-Tag', 'noindex');
        $this->get('http://unknown.test/')->assertNotFound()->assertSee('There is no open store at this address');

        // API and admin paths are not swallowed by the shell.
        $this->getJson('http://berry.test/api/v1/nope')->assertNotFound()->assertJsonPath('success', false);
        $this->get('http://berry.test/admin/login')->assertNotFound();

        unlink($shell);
    }
}
