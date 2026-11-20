<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Storefront\Infrastructure\Models\StorefrontRedirect;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * B16: storefront redirects — automatic 301s when a product, category, brand, content page, blog
 * post or landing page gets a new address (chains collapsed, loops and live addresses removed),
 * the merchant's own redirects (validation, chains, audit, list, export, test), serving from the
 * HTML shell (live pages win, query kept, hits counted once a minute), the public resolve
 * endpoint, permissions and isolation.
 */
class StorefrontRedirectsB16Test extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const API = '/api/v1/storefront/redirects';

    private const RESOLVE = 'http://berry.test/api/v1/store/redirects/resolve';

    /** @var array<string, mixed> */
    private array $t;

    private string $shell;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        Storage::fake((string) config('media.disk'));
        $this->shell = (string) tempnam(sys_get_temp_dir(), 'shell');
        file_put_contents($this->shell, '<!doctype html><html><head><title>Storefront</title></head><body><div id="root"></div></body></html>');
        config(['storefront.shell_path' => $this->shell, 'app.url' => 'https://admin.example.test']);
        $this->t = $this->openStore('Berry Kids', 'berry.test');
    }

    protected function tearDown(): void
    {
        @unlink($this->shell);
        parent::tearDown();
    }

    /**
     * @return array<string, string> from => to of the store's redirects
     */
    private function redirects(): array
    {
        return $this->inTenant($this->t['organization'], fn () => StorefrontRedirect::query()->orderBy('from_path')->pluck('to_path', 'from_path')->all());
    }

    private function product(string $name, string $sku, string $slug): string
    {
        $product = $this->makeProduct($this->t['unit']->id, $name, [[$sku, '100.00']]);
        $this->publish($product['id'], ['slug' => $slug]);

        return $product['id'];
    }

    /**
     * @param  list<string>  $permissions
     */
    private function staff(array $permissions): User
    {
        $organization = $this->t['organization'];

        return $this->createUserWithRole($organization, $this->inTenant($organization, function () use ($permissions) {
            $role = Role::query()->create(['name' => 'Staff '.Str::random(4)]);
            $role->permissions()->sync($permissions);

            return $role;
        }));
    }

    public function test_a_new_product_address_adds_a_301_and_chains_collapse_without_loops(): void
    {
        $id = $this->product('Polo', 'POLO-1', 'polo');
        $this->assertSame([], $this->redirects());

        $this->publish($id, ['slug' => 'polo-shirt']);
        $this->assertSame(['/product/polo' => '/product/polo-shirt'], $this->redirects());
        $row = $this->inTenant($this->t['organization'], fn () => StorefrontRedirect::query()->firstOrFail());
        $this->assertSame([301, 'auto'], [$row->type, $row->source]);

        // A → B, B → C ⇒ A → C.
        $this->publish($id, ['slug' => 'polo-tee']);
        $this->assertSame(['/product/polo' => '/product/polo-tee', '/product/polo-shirt' => '/product/polo-tee'], $this->redirects());

        // Back to the first address: it is live again, so no redirect stays from it (no loop).
        $this->publish($id, ['slug' => 'polo']);
        $this->assertSame(['/product/polo-shirt' => '/product/polo', '/product/polo-tee' => '/product/polo'], $this->redirects());

        // Saving without a new address changes nothing.
        $this->publish($id, ['slug' => 'polo', 'is_featured' => true]);
        $this->assertCount(2, $this->redirects());
    }

    public function test_categories_brands_content_pages_blog_posts_and_landing_pages_get_redirects(): void
    {
        $org = $this->t['organization'];
        $category = $this->category($org, 'Tea');
        $this->listCategory($category, ['slug' => 'tea']);
        $this->listCategory($category, ['slug' => 'green-tea']);
        $brand = $this->brand($org, 'Pran');
        $this->listBrand($brand, ['slug' => 'pran']);
        $this->listBrand($brand, ['slug' => 'pran-foods']);
        $page = $this->postJson('/api/v1/cms/pages', ['slug' => 'about', 'title' => 'About', 'status' => 'published'])->assertCreated()->json('data.id');
        $this->patchJson("/api/v1/cms/pages/{$page}", ['slug' => 'about-us'])->assertOk();
        $post = $this->postJson('/api/v1/cms/blog-posts', ['slug' => 'dal', 'title' => 'Dal', 'status' => 'published'])->assertCreated()->json('data.id');
        $this->patchJson("/api/v1/cms/blog-posts/{$post}", ['slug' => 'dal-soup'])->assertOk();

        $landing = $this->postJson('/api/v1/storefront/builder/documents', ['kind' => 'page', 'key' => 'landing:eid', 'title' => 'Eid'])->assertCreated()->json('data.id');
        // A draft landing page had no visitors: its new address adds no redirect.
        $this->postJson("/api/v1/storefront/builder/documents/{$landing}/address", ['slug' => 'eid-draft'])->assertOk()->assertJsonPath('data.path', '/p/eid-draft');
        $this->putJson("/api/v1/storefront/builder/documents/{$landing}/draft", ['revision' => 0, 'content' => ['schema_version' => 1, 'sections' => [[
            'id' => 's_main', 'type' => 'section', 'columns' => [['id' => 'c_main', 'width' => ['base' => 100], 'elements' => [
                ['id' => 'e_head', 'type' => 'heading', 'props' => ['text' => 'Eid sale', 'level' => 1]],
            ]]],
        ]]]])->assertOk();
        $this->postJson("/api/v1/storefront/builder/documents/{$landing}/publish")->assertOk();
        DB::table('storefront_domains')->where('host', 'berry.test')->update(['entry_path' => '/p/eid-draft']);
        $this->postJson("/api/v1/storefront/builder/documents/{$landing}/address", ['slug' => 'eid-sale'])->assertOk()->assertJsonPath('data.path', '/p/eid-sale');
        $this->assertSame('/p/eid-sale', DB::table('storefront_domains')->where('host', 'berry.test')->value('entry_path'));

        $this->assertSame([
            '/blog/dal' => '/blog/dal-soup',
            '/brand/pran' => '/brand/pran-foods',
            '/category/tea' => '/category/green-tea',
            '/p/eid-draft' => '/p/eid-sale',
            '/pages/about' => '/pages/about-us',
        ], $this->redirects());
        $this->assertSame(2, DB::table('audit_logs')->where('action', 'storefront.builder_address_changed')->count());

        // A new landing page on an old address takes it back.
        $this->postJson('/api/v1/storefront/builder/documents', ['kind' => 'page', 'key' => 'landing:eid-draft', 'title' => 'Again'])->assertCreated();
        $this->assertArrayNotHasKey('/p/eid-draft', $this->redirects());

        // Address rules.
        $this->postJson("/api/v1/storefront/builder/documents/{$landing}/address", ['slug' => 'eid-draft'])->assertStatus(409)->assertJsonPath('error.code', 'DOCUMENT_EXISTS');
        $home = $this->postJson('/api/v1/storefront/builder/documents', ['kind' => 'page', 'key' => 'home', 'title' => 'Home'])->assertCreated()->json('data.id');
        $this->postJson("/api/v1/storefront/builder/documents/{$home}/address", ['slug' => 'start'])->assertStatus(422)->assertJsonPath('error.code', 'NOT_A_LANDING_PAGE');
        $this->postJson("/api/v1/storefront/builder/documents/{$landing}/address", ['slug' => 'home'])->assertStatus(422);
    }

    public function test_the_shell_redirects_old_addresses_keeps_the_query_and_counts_hits_once_a_minute(): void
    {
        $id = $this->product('Polo', 'POLO-1', 'polo');
        $this->publish($id, ['slug' => 'polo-shirt']);

        $this->get('http://berry.test/product/polo?utm_source=mail')
            ->assertStatus(301)->assertRedirect('http://berry.test/product/polo-shirt?utm_source=mail');
        // Case, trailing slash and encoding do not matter.
        $this->get('http://berry.test/Product/POLO/')->assertStatus(301);
        $this->get('http://berry.test/product/polo-shirt')->assertOk();
        $row = fn () => $this->inTenant($this->t['organization'], fn () => StorefrontRedirect::query()->firstOrFail());
        $this->assertSame(1, $row()->hits);
        $this->assertNotNull($row()->last_hit_at);

        $this->travel(61)->seconds();
        $this->get('http://berry.test/product/polo')->assertStatus(301);
        $this->assertSame(3, $row()->hits);

        // A manual 302 to another site; a live page is never redirected.
        $this->postJson(self::API, ['from_path' => '/old-sale', 'to_path' => 'https://example.com/sale', 'type' => 302])->assertCreated();
        $this->get('http://berry.test/old-sale')->assertStatus(302)->assertRedirect('https://example.com/sale');
        $this->inTenant($this->t['organization'], fn () => StorefrontRedirect::query()->create(['from_path' => '/product/polo-shirt', 'to_path' => '/shop', 'type' => 301, 'source' => 'manual']));
        $this->get('http://berry.test/product/polo-shirt')->assertOk();
        $this->get('http://berry.test/nothing-here')->assertNotFound();

        // The SPA's resolve endpoint (public).
        $this->getJson(self::RESOLVE.'?path=/product/polo')->assertOk()->assertJsonPath('data', ['to' => '/product/polo-shirt', 'type' => 301]);
        $this->getJson(self::RESOLVE.'?path=/nothing')->assertOk()->assertJsonPath('data', null);
        $this->getJson(self::RESOLVE)->assertOk()->assertJsonPath('data', null);
    }

    public function test_manual_redirects_are_validated_chained_audited_listed_and_exported(): void
    {
        $this->product('Polo', 'POLO-1', 'polo');

        $a = $this->postJson(self::API, ['from_path' => 'https://berry.test/Old-Page/?x=1', 'to_path' => '/new-page'])->assertCreated()
            ->assertJsonPath('data.from_path', '/old-page')->assertJsonPath('data.to_path', '/new-page')
            ->assertJsonPath('data.type', 301)->assertJsonPath('data.source', 'manual')->assertJsonPath('data.hits', 0)->json('data.id');

        foreach ([
            [['from_path' => '/cart', 'to_path' => '/shop'], 'from_path'],
            [['from_path' => '/account/orders', 'to_path' => '/shop'], 'from_path'],
            [['from_path' => '/product/polo', 'to_path' => '/shop'], 'from_path'],
            [['from_path' => '/OLD-PAGE', 'to_path' => '/shop'], 'from_path'],
            [['from_path' => 'has space', 'to_path' => '/shop'], 'from_path'],
            [['from_path' => '/x', 'to_path' => 'javascript:alert(1)'], 'to_path'],
            [['from_path' => '/x', 'to_path' => '/x'], 'to_path'],
            [['from_path' => '/new-page', 'to_path' => '/old-page'], 'to_path'],
            [['from_path' => '/x', 'to_path' => '/y', 'type' => 307], 'type'],
        ] as [$body, $field]) {
            $this->postJson(self::API, $body)->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED')->assertJsonValidationErrors($field, 'error.details');
        }

        // B → C: what went to B (A) now goes to C; a target that is redirected is followed.
        $this->postJson(self::API, ['from_path' => '/new-page', 'to_path' => '/final'])->assertCreated();
        $this->postJson(self::API, ['from_path' => '/older', 'to_path' => 'https://berry.test/old-page'])->assertCreated()->assertJsonPath('data.to_path', '/final');
        $this->assertSame(['/new-page' => '/final', '/old-page' => '/final', '/older' => '/final'], $this->redirects());

        // PATCH: an automatic redirect becomes the merchant's own.
        $auto = $this->inTenant($this->t['organization'], fn () => StorefrontRedirect::query()->create(['from_path' => '/gone', 'to_path' => '/shop', 'source' => 'auto']));
        $this->patchJson(self::API."/{$auto->id}", ['type' => 302])->assertOk()->assertJsonPath('data.source', 'manual')->assertJsonPath('data.type', 302);
        $this->patchJson(self::API."/{$a}", ['to_path' => '/old-page'])->assertStatus(422)->assertJsonValidationErrors('to_path', 'error.details');

        // List, filters, test, export.
        $this->getJson(self::API.'?per_page=2')->assertOk()->assertJsonPath('meta.pagination.total', 4)->assertJsonCount(2, 'data');
        $this->getJson(self::API.'?search=OLD')->assertOk()->assertJsonPath('meta.pagination.total', 2);
        $this->getJson(self::API.'?source=auto')->assertOk()->assertJsonPath('meta.pagination.total', 0);
        $this->getJson(self::API.'/test?path=/Old-Page?utm=1')->assertOk()
            ->assertJsonPath('data.path', '/old-page')->assertJsonPath('data.redirect.id', $a)->assertJsonPath('data.final_path', '/final')->assertJsonPath('data.live', false);
        $this->getJson(self::API.'/test?path=/product/polo')->assertOk()->assertJsonPath('data.redirect', null)->assertJsonPath('data.live', true);
        $csv = $this->get(self::API.'?export=csv')->assertOk();
        $this->assertStringContainsString('text/csv', (string) $csv->headers->get('Content-Type'));
        $this->assertStringContainsString('/old-page', $csv->streamedContent());

        $this->deleteJson(self::API."/{$a}")->assertNoContent();
        $this->assertSame(1, DB::table('audit_logs')->where('action', 'storefront.redirect_deleted')->count());
        $this->assertSame(3, DB::table('audit_logs')->where('action', 'storefront.redirect_created')->count());
        $this->assertSame(1, DB::table('audit_logs')->where('action', 'storefront.redirect_updated')->count());
    }

    public function test_redirects_are_scoped_to_their_store_and_need_storefront_manage(): void
    {
        $id = $this->inTenant($this->t['organization'], fn () => StorefrontRedirect::query()->create(['from_path' => '/old', 'to_path' => '/shop'])->id);

        $other = $this->openStore('Other Shop', 'other.test');
        $this->getJson(self::API)->assertOk()->assertJsonPath('meta.pagination.total', 0);
        $this->patchJson(self::API."/{$id}", ['type' => 302])->assertNotFound();
        $this->deleteJson(self::API."/{$id}")->assertNotFound();
        // The other store can use the same old address for itself.
        $this->postJson(self::API, ['from_path' => '/old', 'to_path' => '/blog'])->assertCreated();
        $this->get('http://other.test/old')->assertStatus(301)->assertRedirect('http://other.test/blog');
        $this->getJson('http://other.test/api/v1/store/redirects/resolve?path=/old')->assertJsonPath('data.to', '/blog');
        $this->assertSame(['/old' => '/shop'], $this->redirects());
        unset($other);

        $this->actingAsUser($this->staff(['storefront.view']));
        $this->getJson(self::API)->assertForbidden();
        $this->postJson(self::API, ['from_path' => '/a', 'to_path' => '/b'])->assertForbidden();
        $this->getJson(self::API.'/test?path=/a')->assertForbidden();
    }
}
