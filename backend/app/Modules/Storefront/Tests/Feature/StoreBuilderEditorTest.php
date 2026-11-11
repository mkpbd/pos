<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * B2: what the visual store builder's editor needs from the API — the canvas resolver for
 * unsaved elements, the canvas context (store bootstrap of the staff member's organization),
 * renaming, `path` / `preview_url` on documents, permissions and tenant isolation.
 */
class StoreBuilderEditorTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

    private const RESOLVE = '/api/v1/storefront/builder/resolve';

    private const CANVAS = '/api/v1/storefront/builder/canvas-context';

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        Date::setTestNow('2026-11-11T10:00:00+06:00');
    }

    /**
     * An open storefront on $host; its admin stays signed in.
     *
     * @return array{organization: Organization, admin: User}
     */
    private function store(string $name, string $host): array
    {
        $tenant = $this->provisionTenant($name);
        $this->actingAsUser($tenant['admin']);
        $this->postJson('/api/v1/storefront/domains', ['host' => $host])->assertCreated();
        $this->patchJson('/api/v1/storefront/settings', ['site_name' => $name, 'is_enabled' => true])->assertOk();

        return $tenant;
    }

    private function image(string $name = 'photo.jpg'): string
    {
        return $this->post('/api/v1/media', ['file' => UploadedFile::fake()->image($name, 1600, 600)], $this->spaHeaders())->assertSuccessful()->json('data.id');
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function banner(string $placement, string $name, array $overrides = []): string
    {
        return $this->postJson('/api/v1/storefront/banners', $overrides + [
            'placement' => $placement,
            'name' => $name,
            'title' => "{$name} title",
            'desktop_media_id' => $this->image(),
        ])->assertCreated()->json('data.id');
    }

    private function createPage(string $key = 'home', string $title = 'Home'): string
    {
        return $this->postJson(self::DOCS, ['kind' => 'page', 'key' => $key, 'title' => $title])->assertCreated()->json('data.id');
    }

    /**
     * A one-section document holding the given elements.
     *
     * @param  list<array<string, mixed>>  $elements
     * @return array<string, mixed>
     */
    private function page(array $elements): array
    {
        return ['schema_version' => 1, 'sections' => [[
            'id' => 's_main', 'type' => 'section',
            'columns' => [['id' => 'c_main', 'width' => ['base' => 100], 'elements' => $elements]],
        ]]];
    }

    private function storeUrl(string $host): string
    {
        return (parse_url((string) config('app.url'), PHP_URL_SCHEME) ?: 'https').'://'.$host;
    }

    private function role(Organization $organization, string $name, array $permissions): User
    {
        $roleId = $this->postJson('/api/v1/roles', ['name' => $name, 'permissions' => $permissions])->assertCreated()->json('data.id');

        return $this->createUserWithRole($organization, $this->inTenant($organization, fn () => Role::query()->findOrFail($roleId)));
    }

    public function test_resolve_validates_and_resolves_each_element_on_its_own(): void
    {
        ['admin' => $berryAdmin] = $this->store('Berry Kids', 'berry.test');
        $berryBanner = $this->banner('hero_slider', 'Berry hero');
        $berryImage = $this->image('berry.jpg');

        $this->store('Tiny Toes', 'tiny.test');
        $hero = $this->banner('hero_slider', 'Tiny hero', ['translations' => ['bn' => ['title' => 'বাংলা শিরোনাম']]]);
        $image = $this->image('tiny.jpg');
        $missing = '01900000-0000-7000-8000-0000000000aa';

        $elements = [
            ['id' => 'e_slider', 'type' => 'hero_slider', 'items' => [['item_type' => 'banner', 'item_id' => $hero]]],
            ['id' => 'e_grid', 'type' => 'product_grid', 'title' => 'Featured', 'config' => ['source' => 'featured', 'limit' => 8]],
            ['id' => 'e_text', 'type' => 'rich_text', 'title' => 'About us', 'config' => ['body_html' => '<p>Hello</p><script>alert(1)</script>'],
                'translations' => ['bn' => ['title' => 'আমাদের সম্পর্কে']]],
            // Invalid elements: each reported on its own, none fails the request.
            ['id' => 'e_empty', 'type' => 'hero_slider', 'items' => []],
            ['id' => 'e_limit', 'type' => 'product_grid', 'config' => ['source' => 'featured', 'limit' => 999]],
            ['id' => 'e_foreign', 'type' => 'hero_slider', 'items' => [['item_type' => 'banner', 'item_id' => $berryBanner]]],
            ['id' => 'e_heading', 'type' => 'heading', 'config' => []],
            ['id' => 'e_video', 'type' => 'video'],
            ['id' => 'e_title', 'type' => 'newsletter', 'title' => str_repeat('x', 121)],
        ];
        $response = $this->postJson(self::RESOLVE, ['elements' => $elements, 'media_ids' => [$image, strtoupper($image), $berryImage, $missing]])->assertOk();

        $this->assertSame(['e_slider', 'e_grid', 'e_text'], array_keys($response->json('data.data')));
        $response->assertJsonPath('data.data.e_slider.type', 'hero_slider')
            ->assertJsonPath('data.data.e_slider.state', 'live')
            ->assertJsonPath('data.data.e_slider.banners.0.id', $hero)
            ->assertJsonPath('data.data.e_slider.banners.0.title', 'Tiny hero title')
            ->assertJsonPath('data.data.e_grid.state', 'empty')
            ->assertJsonPath('data.data.e_grid.products', [])
            ->assertJsonPath('data.data.e_text.title', 'About us')
            ->assertJsonPath('data.data.e_text.config.body_html', '<p>Hello</p>');

        $errors = $response->json('data.errors');
        $this->assertSame(['e_empty', 'e_limit', 'e_foreign', 'e_heading', 'e_video', 'e_title', $berryImage, $missing], array_keys($errors));
        $this->assertSame('props.items', $errors['e_empty'][0]['path']);
        $this->assertSame('props.config.limit', $errors['e_limit'][0]['path']);
        $this->assertSame(['path' => 'props.items', 'code' => 'BANNER_NOT_FOUND', 'ids' => [$berryBanner]], array_diff_key($errors['e_foreign'][0], ['message' => true]));
        $this->assertSame('type', $errors['e_heading'][0]['path']);
        $this->assertSame('type', $errors['e_video'][0]['path']);
        $this->assertSame('props.title', $errors['e_title'][0]['path']);
        // Another organization's media is reported like a missing one and never resolved.
        $this->assertSame('MEDIA_NOT_FOUND', $errors[$berryImage][0]['code']);
        $this->assertSame('MEDIA_NOT_FOUND', $errors[$missing][0]['code']);
        $this->assertSame([$image], array_keys($response->json('data.media')));
        $response->assertJsonPath("data.media.{$image}.width", 1600)->assertJsonMissingPath("data.media.{$image}.id");
        $this->assertStringNotContainsString('alert(1)', (string) $response->getContent());

        // A resolved element is exactly what the draft render shows for it.
        $home = $this->createPage();
        $this->putJson(self::DOCS."/{$home}/draft", ['revision' => 0, 'content' => $this->page([
            ['id' => 'e_slider', 'type' => 'hero_slider', 'props' => ['items' => [['item_type' => 'banner', 'item_id' => $hero]]]],
            ['id' => 'e_grid', 'type' => 'product_grid', 'props' => ['title' => 'Featured', 'config' => ['source' => 'featured', 'limit' => 8]]],
            ['id' => 'e_text', 'type' => 'rich_text', 'props' => ['title' => 'About us', 'config' => ['body_html' => '<p>Hello</p>']], 'translations' => ['bn' => ['title' => 'আমাদের সম্পর্কে']]],
        ])])->assertOk();
        foreach (['en', 'bn'] as $lang) {
            $render = $this->getJson(self::DOCS."/{$home}/render?lang={$lang}")->assertOk()->json('data.data');
            $resolved = $this->postJson(self::RESOLVE, ['elements' => array_slice($elements, 0, 3), 'locale' => $lang])->assertOk()->json('data.data');
            $this->assertSame($render, $resolved, $lang);
        }

        // The locale picks the language; unknown ones fall back to the store default.
        $this->postJson(self::RESOLVE, ['elements' => array_slice($elements, 0, 3), 'locale' => 'bn'])->assertOk()
            ->assertJsonPath('data.data.e_text.title', 'আমাদের সম্পর্কে')
            ->assertJsonPath('data.data.e_slider.banners.0.title', 'বাংলা শিরোনাম');
        $this->postJson(self::RESOLVE, ['elements' => array_slice($elements, 0, 3), 'locale' => 'fr'])->assertOk()
            ->assertJsonPath('data.data.e_text.title', 'About us');
        $this->patchJson('/api/v1/storefront/settings', ['bangla_enabled' => false])->assertOk();
        $this->postJson(self::RESOLVE, ['elements' => array_slice($elements, 0, 3), 'locale' => 'bn'])->assertOk()
            ->assertJsonPath('data.data.e_text.title', 'About us');

        // Nothing to resolve: empty maps are JSON objects.
        $empty = $this->postJson(self::RESOLVE, [])->assertOk();
        $this->assertStringContainsString('"data":{"data":{},"media":{},"errors":{}}', (string) $empty->getContent());

        // Berry's admin resolves Berry's banner and image, not Tiny's.
        $this->actingAsUser($berryAdmin);
        $berry = $this->postJson(self::RESOLVE, ['elements' => [$elements[0], $elements[5]], 'media_ids' => [$image, $berryImage]])->assertOk();
        $this->assertSame(['e_foreign'], array_keys($berry->json('data.data')));
        $this->assertSame([$berryImage], array_keys($berry->json('data.media')));
        $this->assertSame(['e_slider', $image], array_keys($berry->json('data.errors')));
        $berry->assertJsonPath('data.errors.e_slider.0.code', 'BANNER_NOT_FOUND');
    }

    public function test_resolve_rejects_only_a_malformed_envelope(): void
    {
        $this->store('Berry Kids', 'berry.test');
        $grid = fn (string $id) => ['id' => $id, 'type' => 'product_grid'];

        foreach ([
            ['elements' => 'nope'],
            ['elements' => ['a' => $grid('e_one')]],
            ['elements' => array_map(fn (int $i) => $grid("e_{$i}"), range(1, 61))],
            ['elements' => [$grid('e_same'), $grid('e_same')]],
            ['elements' => [$grid('E-Upper')]],
            ['elements' => [['type' => 'product_grid']]],
            ['elements' => [['id' => 'e_one']]],
            ['elements' => ['not an object']],
            ['media_ids' => ['not-a-uuid']],
            ['media_ids' => array_map(fn (int $i) => sprintf('01900000-0000-7000-8000-%012d', $i), range(1, 201))],
            ['locale' => ['bn']],
        ] as $payload) {
            $this->postJson(self::RESOLVE, $payload)->assertUnprocessable()->assertJsonPath('error.code', 'VALIDATION_FAILED');
        }

        // Limits themselves are fine.
        $this->postJson(self::RESOLVE, [
            'elements' => array_map(fn (int $i) => $grid("e_{$i}"), range(1, 60)),
            'media_ids' => array_map(fn (int $i) => sprintf('01900000-0000-7000-8000-%012d', $i), range(1, 200)),
        ])->assertOk()->assertJsonCount(60, 'data.data')->assertJsonCount(200, 'data.errors');
    }

    public function test_canvas_context_is_the_store_bootstrap_of_the_own_organization(): void
    {
        ['organization' => $berry, 'admin' => $berryAdmin] = $this->store('Berry Kids', 'berry.test');

        // Open store: the same payload the staff member gets on the store, per language.
        foreach (['en', 'bn'] as $lang) {
            $context = $this->getJson(self::CANVAS."?lang={$lang}")->assertOk();
            $this->assertSame($this->getJson("http://berry.test/api/v1/store/bootstrap?lang={$lang}")->assertOk()->json('data'), $context->json('data.bootstrap'), $lang);
            $context->assertJsonPath('data.bootstrap.locale', $lang)
                ->assertJsonPath('data.bootstrap.preview', false)
                ->assertJsonPath('data.store_url', $this->storeUrl('berry.test'))
                ->assertJsonPath('data.locales', ['en', 'bn']);
        }

        // Closed: still served (as the staff preview the store would show).
        $this->patchJson('/api/v1/storefront/settings', ['is_enabled' => false, 'bangla_enabled' => false])->assertOk();
        $closed = $this->getJson(self::CANVAS.'?lang=bn')->assertOk()
            ->assertJsonPath('data.bootstrap.preview', true)
            ->assertJsonPath('data.bootstrap.locale', 'en')
            ->assertJsonPath('data.locales', ['en']);
        $this->assertSame($this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()->json('data'), $closed->json('data.bootstrap'));
        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertNotFound();
        $this->getJson(self::CANVAS)->assertUnauthorized();

        // No domain and no settings saved yet: the organization's own store, no URL.
        ['admin' => $plainAdmin] = $this->provisionTenant('Plain Shop');
        $this->actingAsUser($plainAdmin);
        $this->getJson(self::CANVAS)->assertOk()
            ->assertJsonPath('data.bootstrap.store.name', 'Plain Shop')
            ->assertJsonPath('data.bootstrap.preview', true)
            ->assertJsonPath('data.bootstrap.builder.home', false)
            ->assertJsonPath('data.store_url', null)
            ->assertJsonPath('data.locales', ['en', 'bn']);

        // Tenant isolation: each staff member gets their own store only.
        $this->store('Tiny Toes', 'tiny.test');
        $this->getJson(self::CANVAS)->assertOk()
            ->assertJsonPath('data.bootstrap.store.name', 'Tiny Toes')
            ->assertJsonPath('data.store_url', $this->storeUrl('tiny.test'));
        $this->actingAsUser($berryAdmin);
        $this->getJson(self::CANVAS)->assertOk()->assertJsonPath('data.bootstrap.store.name', 'Berry Kids');

        // storefront.view is enough; a cashier has no access.
        $this->actingAsUser($this->createUserWithRole($berry, SystemRole::Cashier));
        $this->getJson(self::CANVAS)->assertForbidden();
    }

    public function test_documents_carry_path_and_preview_url_and_can_be_renamed(): void
    {
        ['admin' => $admin] = $this->store('Berry Kids', 'berry.test');
        $base = $this->storeUrl('berry.test');
        $home = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home'])->assertCreated()
            ->assertJsonPath('data.path', '/')
            ->assertJsonPath('data.preview_url', "{$base}/?preview=draft")
            ->json('data.id');
        $landing = $this->createPage('landing:eid-sale', 'Eid sale');

        $this->getJson(self::DOCS)->assertOk()
            ->assertJsonPath('data.0.key', 'home')
            ->assertJsonPath('data.0.path', '/')
            ->assertJsonPath('data.1.path', '/p/eid-sale')
            ->assertJsonPath('data.1.preview_url', "{$base}/p/eid-sale?preview=draft");
        $this->getJson(self::DOCS."/{$landing}")->assertOk()->assertJsonPath('data.preview_url', "{$base}/p/eid-sale?preview=draft");
        $this->putJson(self::DOCS."/{$home}/draft", ['revision' => 0, 'content' => $this->page([['id' => 'e_title', 'type' => 'heading', 'props' => ['text' => 'Hi']]])])
            ->assertOk()->assertJsonPath('data.path', '/');

        // The primary domain is used.
        $this->postJson('/api/v1/storefront/domains', ['host' => 'shop.berry.test', 'is_primary' => true])->assertCreated();
        $this->getJson(self::DOCS."/{$home}")->assertJsonPath('data.preview_url', $this->storeUrl('shop.berry.test').'/?preview=draft');

        // Rename: audited, the draft and its revision unchanged.
        $this->patchJson(self::DOCS."/{$landing}", ['title' => '  Eid big sale '])->assertOk()
            ->assertJsonPath('data.title', 'Eid big sale')
            ->assertJsonPath('data.key', 'landing:eid-sale')
            ->assertJsonPath('data.draft_revision', 0)
            ->assertJsonPath('data.path', '/p/eid-sale');
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_renamed']);
        $this->getJson(self::DOCS."/{$landing}")->assertJsonPath('data.title', 'Eid big sale');
        foreach ([[], ['title' => ''], ['title' => str_repeat('x', 161)], ['title' => ['x']]] as $payload) {
            $this->patchJson(self::DOCS."/{$landing}", $payload)->assertUnprocessable()->assertJsonPath('error.code', 'VALIDATION_FAILED');
        }

        // A published page's new title reaches the store.
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();
        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/builder/pages/home')->assertJsonPath('data.document.title', 'Home');
        $this->actingAsUser($admin);
        $this->patchJson(self::DOCS."/{$home}", ['title' => 'Welcome'])->assertOk();
        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/builder/pages/home')->assertJsonPath('data.document.title', 'Welcome');

        // Without a domain there is nothing to preview on.
        ['admin' => $plainAdmin] = $this->provisionTenant('Plain Shop');
        $this->actingAsUser($plainAdmin);
        $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home'])->assertCreated()
            ->assertJsonPath('data.path', '/')
            ->assertJsonPath('data.preview_url', null);
    }

    public function test_permissions_and_tenant_isolation_of_the_editor_endpoints(): void
    {
        ['organization' => $berry, 'admin' => $berryAdmin] = $this->store('Berry Kids', 'berry.test');
        $berryHome = $this->createPage();
        $element = ['id' => 'e_grid', 'type' => 'product_grid'];

        // storefront.view reads the canvas context but neither resolves nor renames.
        $viewer = $this->role($berry, 'Store viewer', ['storefront.view']);
        $editor = $this->role($berry, 'Editor', ['storefront.view', 'storefront.manage']);
        $this->actingAsUser($viewer);
        $this->getJson(self::CANVAS)->assertOk();
        $this->getJson(self::DOCS)->assertOk()->assertJsonPath('data.0.path', '/');
        $this->postJson(self::RESOLVE, ['elements' => [$element]])->assertForbidden();
        $this->patchJson(self::DOCS."/{$berryHome}", ['title' => 'Mine'])->assertForbidden();

        // storefront.manage (without publish) resolves and renames.
        $this->actingAsUser($editor);
        $this->postJson(self::RESOLVE, ['elements' => [$element]])->assertOk()->assertJsonPath('data.data.e_grid.type', 'product_grid');
        $this->patchJson(self::DOCS."/{$berryHome}", ['title' => 'Start'])->assertOk();

        $this->actingAsUser($this->createUserWithRole($berry, SystemRole::Cashier));
        $this->postJson(self::RESOLVE, ['elements' => [$element]])->assertForbidden();
        $this->patchJson(self::DOCS."/{$berryHome}", ['title' => 'Mine'])->assertForbidden();
        $this->asVisitor();
        $this->postJson(self::RESOLVE, ['elements' => [$element]])->assertUnauthorized();

        // Another organization cannot rename (or see) Berry's document.
        $this->store('Tiny Toes', 'tiny.test');
        $this->patchJson(self::DOCS."/{$berryHome}", ['title' => 'Taken'])->assertNotFound();
        $this->getJson(self::DOCS)->assertOk()->assertJsonCount(0, 'data');
        $this->actingAsUser($berryAdmin);
        $this->getJson(self::DOCS."/{$berryHome}")->assertJsonPath('data.title', 'Start');
    }

    private function asVisitor(): void
    {
        $this->app['auth']->forgetGuards();
    }
}
