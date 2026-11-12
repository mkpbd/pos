<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\Media\Infrastructure\Models\Media;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Storefront\Application\Builder\Templates\BuilderTemplateLibrary;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\Templates\PortableTemplate;
use App\Modules\Storefront\Domain\ThemePresets;
use App\Modules\Storefront\Infrastructure\Models\Banner;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderTemplate;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * B5: the template library API (list, apply, save / delete own templates), "start from a demo
 * look" (drafts only) and "publish all" — photo import with dedupe, banners in the right
 * organization, menu references, limits, permissions and tenant isolation.
 */
class BuilderTemplatesApiTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const API = '/api/v1/storefront/builder';

    private const DOCS = '/api/v1/storefront/builder/documents';

    private const STORE = 'http://berry.test/api/v1/store';

    /** @var array<string, mixed> */
    private array $t;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        // Renditions are not what is tested here.
        Queue::fake();
        Date::setTestNow('2026-11-12T10:00:00+06:00');
        $this->t = $this->openStore('Berry Kids', 'berry.test');
    }

    private function library(): BuilderTemplateLibrary
    {
        return app(BuilderTemplateLibrary::class);
    }

    private function instantiate(string $id, string $context): TestResponse
    {
        return $this->postJson(self::API."/templates/{$id}/instantiate", ['context' => $context]);
    }

    private function createDoc(string $kind, string $key, string $title): string
    {
        return $this->postJson(self::DOCS, ['kind' => $kind, 'key' => $key, 'title' => $title])->assertCreated()->json('data.id');
    }

    /**
     * @param  list<array<string, mixed>>  $sections
     */
    private function saveDraft(string $id, array $sections): TestResponse
    {
        $revision = $this->getJson(self::DOCS."/{$id}")->assertOk()->json('data.draft_revision');

        return $this->putJson(self::DOCS."/{$id}/draft", ['revision' => $revision, 'content' => ['schema_version' => 1, 'sections' => $sections]]);
    }

    private function mediaCount(string $organizationId): int
    {
        return Media::query()->withoutGlobalScopes()->where('organization_id', $organizationId)->count();
    }

    private function bannerCount(string $organizationId): int
    {
        return Banner::query()->withoutGlobalScopes()->where('organization_id', $organizationId)->count();
    }

    /**
     * @param  list<array<string, mixed>>  $sections
     * @return list<array<string, mixed>>
     */
    private function elementsOf(array $sections, ?string $type = null): array
    {
        $result = [];
        BuilderDocumentSchema::walk(['sections' => $sections], function (array $node, string $path, string $kind) use (&$result, $type) {
            if ($kind === 'element' && ($type === null || $node['type'] === $type)) {
                $result[] = $node;
            }
        });

        return $result;
    }

    /**
     * @param  list<string>  $permissions
     */
    private function userWith(array $permissions): void
    {
        $this->actingAsUser($this->t['admin']);
        $roleId = $this->postJson('/api/v1/roles', ['name' => 'Role '.count($permissions).random_int(1, 9999), 'permissions' => $permissions])->assertCreated()->json('data.id');
        $this->actingAsUser($this->createUserWithRole($this->t['organization'], $this->inTenant($this->t['organization'], fn () => Role::query()->findOrFail($roleId))));
    }

    public function test_templates_are_listed_with_filters_and_without_content(): void
    {
        $manifest = $this->library()->all();
        $list = $this->getJson(self::API.'/templates')->assertOk()->json('data');
        $this->assertCount(count($manifest), $list);
        $this->assertSame(['id', 'scope', 'preset', 'category', 'name', 'description', 'thumbnail_url', 'allowed_in', 'requires', 'source', 'created_at'], array_keys($list[0]));
        $this->assertSame(array_column($manifest, 'id'), array_column($list, 'id'));
        $this->assertSame(['builtin'], array_values(array_unique(array_column($list, 'source'))));

        $sections = $this->getJson(self::API.'/templates?scope=section')->assertOk()->json('data');
        $this->assertGreaterThanOrEqual(24, count($sections));
        $this->assertSame(['section'], array_values(array_unique(array_column($sections, 'scope'))));

        $vegan = $this->getJson(self::API.'/templates?preset=vegan')->assertOk()->json('data');
        $this->assertSame(['vegan'], array_values(array_unique(array_column($vegan, 'preset'))));
        $this->assertContains('site-vegan', array_column($vegan, 'id'));
        $neutral = $this->getJson(self::API.'/templates?preset=none&scope=section')->assertOk()->json('data');
        $this->assertSame([null], array_values(array_unique(array_column($neutral, 'preset'))));
        $this->assertGreaterThanOrEqual(6, count($neutral));

        // Context: only templates usable there (contact / FAQ pages on content pages only).
        $cms = array_column($this->getJson(self::API.'/templates?context=cms&scope=page')->assertOk()->json('data'), 'id');
        $this->assertContains('page-contact', $cms);
        $landing = array_column($this->getJson(self::API.'/templates?context=page&scope=page')->assertOk()->json('data'), 'id');
        $this->assertNotContains('page-contact', $landing);
        $this->assertContains('page-sale-landing', $landing);
        $header = $this->getJson(self::API.'/templates?context=header')->assertOk()->json('data');
        $this->assertSame(['site-vegan', 'site-handmade', 'site-classic'], array_column($header, 'id'));
        foreach ($this->getJson(self::API.'/templates?context=footer')->assertOk()->json('data') as $template) {
            $this->assertContains('footer', $template['allowed_in']);
        }
        $this->assertSame([], $this->getJson(self::API.'/templates?source=mine')->assertOk()->json('data'));

        $this->getJson(self::API.'/templates?scope=widget')->assertUnprocessable();
        $this->getJson(self::API.'/templates?context=nowhere')->assertUnprocessable();
    }

    public function test_every_built_in_template_applies_in_each_of_its_contexts_and_saves_into_a_draft(): void
    {
        // Well over a hundred applies and saves in one minute.
        RateLimiter::for('builder-templates', fn () => Limit::none());
        RateLimiter::for('api', fn () => Limit::none());
        $org = $this->t['organization']->id;
        $page = $this->postJson('/api/v1/cms/pages', ['slug' => 'about-us', 'title' => 'About us', 'status' => 'published'])->assertCreated()->json('data.id');
        $documents = [
            'page' => $this->createDoc('page', 'home', 'Home'),
            'cms' => $this->createDoc('page', "cms:{$page}", 'About us'),
            'header' => $this->createDoc('header', 'header', 'Header'),
            'footer' => $this->createDoc('footer', 'footer', 'Footer'),
            'zone' => $this->createDoc('zone', 'zone:listing.top', 'Listing top'),
        ];

        $assets = [];
        $banners = [];
        foreach ($this->library()->all() as $template) {
            foreach ($template['allowed_in'] as $context) {
                $sections = $this->library()->sections($template['id'], $context);
                $assets = [...$assets, ...PortableTemplate::assets($sections)];
                foreach (PortableTemplate::banners($sections) as $b) {
                    $banners[implode('|', [$b['placement'], $b['name'], $b['title'] ?? '', $b['link_url'] ?? '', $b['image']['asset']])] = true;
                }

                $result = $this->instantiate($template['id'], $context)->assertOk()->json('data');
                $this->assertSame(['id' => $template['id'], 'name' => $template['name'], 'scope' => $template['scope'], 'source' => 'builtin'], $result['template']);
                $this->assertSame($context, $result['context']);
                $this->assertNotEmpty($result['nodes'], "{$template['id']} in {$context}");
                // Fresh ids, unique, in the builder's id format.
                $ids = [];
                BuilderDocumentSchema::walk(['sections' => $result['nodes']], function (array $node) use (&$ids) {
                    $ids[] = $node['id'];
                });
                $this->assertSame(array_values(array_unique($ids)), $ids);
                $this->assertDoesNotMatchRegularExpression('/"id":"[sce]_\d+"/', (string) json_encode($result['nodes']));
                // The editor inserts them into the draft: valid for the document's context.
                $this->saveDraft($documents[$context], $result['nodes'])->assertOk();
            }
        }

        // Each photo was imported once (by asset and content hash), each banner created once.
        $this->assertSame(count(array_unique($assets)), $this->mediaCount($org));
        $this->assertSame(count($banners), $this->bannerCount($org));
        $this->assertSame(0, Banner::query()->withoutGlobalScopes()->where('organization_id', '!=', $org)->count());

        // Applying again imports and creates nothing new.
        $again = $this->instantiate('vegan-hero-slider', 'page')->assertOk()->json('data');
        $this->assertSame(['media' => 0, 'banners' => 0, 'banners_reused' => 2], $again['imported']);
        $this->assertSame(count(array_unique($assets)), $this->mediaCount($org));
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_template_used']);
    }

    public function test_applying_imports_photos_creates_banners_and_reuses_them(): void
    {
        $org = $this->t['organization']->id;
        $result = $this->instantiate('classic-department-tiles', 'page')->assertOk()->json('data');
        $this->assertSame(['media' => 3, 'banners' => 3, 'banners_reused' => 0], $result['imported']);
        $grid = $this->elementsOf($result['nodes'], 'banner_grid')[0];
        $this->assertSame('3-col', $grid['props']['config']['layout']);
        $bannerIds = array_column($grid['props']['items'], 'item_id');
        $created = Banner::query()->withoutGlobalScopes()->whereIn('id', $bannerIds)->get();
        $this->assertCount(3, $created);
        foreach ($created as $banner) {
            $this->assertSame($org, $banner->organization_id);
            $this->assertTrue($banner->is_active);
            $this->assertNull($banner->starts_at);
            $this->assertSame('home_promo', $banner->placement->value);
        }
        $men = $created->firstWhere('name', 'Men');
        $this->assertSame('পুরুষ', $men->translations['bn']['kicker']);
        // Alt text from the photo manifest; the media item is the organization's own.
        $media = Media::query()->withoutGlobalScopes()->findOrFail($men->desktop_media_id);
        $this->assertSame($org, $media->organization_id);
        $this->assertSame('Man in a brown overshirt and white T-shirt', $media->alt);
        $this->assertSame('classic-banner-men.jpg', $media->original_name);

        // An image element of another template reuses the same photo; the media library lists it.
        $story = $this->instantiate('page-new-collection', 'page')->assertOk()->json('data');
        $this->assertSame(1, $story['imported']['media']);
        $this->getJson('/api/v1/media?search=classic-banner')->assertOk()->assertJsonCount(4, 'data');

        // A deleted photo is imported again on the next apply.
        $this->instantiate('vegan-story', 'page')->assertOk();
        $image = $this->elementsOf($this->instantiate('vegan-story', 'page')->json('data.nodes'), 'image')[0];
        $this->assertSame(0, $this->instantiate('vegan-story', 'page')->json('data.imported.media'));
        $this->deleteJson("/api/v1/media/{$image['props']['media_id']}")->assertNoContent();
        $this->assertSame(1, $this->instantiate('vegan-story', 'page')->json('data.imported.media'));
    }

    public function test_menu_references_resolve_to_the_stores_menus(): void
    {
        // No menus yet: the menu rows are left out, the rest stays.
        $header = $this->instantiate('site-classic', 'header')->assertOk()->json('data.nodes');
        $this->assertCount(1, $header);
        $this->assertSame([], $this->elementsOf($header, 'menu'));
        $footer = $this->instantiate('site-vegan', 'footer')->assertOk()->json('data.nodes');
        $this->assertSame([], $this->elementsOf($footer, 'menu'));
        $this->assertNotContains('Information', array_column(array_column($this->elementsOf($footer, 'heading'), 'props'), 'text'));

        $main = $this->postJson('/api/v1/storefront/menus', ['name' => 'Main', 'location' => 'main'])->assertCreated()->json('data.id');
        $footerMenu = $this->postJson('/api/v1/storefront/menus', ['name' => 'Help', 'location' => 'footer_2'])->assertCreated()->json('data.id');

        $header = $this->instantiate('site-classic', 'header')->assertOk()->json('data.nodes');
        $this->assertCount(2, $header);
        $this->assertSame([$main], array_column(array_column($this->elementsOf($header, 'menu'), 'props'), 'menu_id'));
        $footer = $this->instantiate('site-vegan', 'footer')->assertOk()->json('data.nodes');
        $this->assertSame([$footerMenu], array_column(array_column($this->elementsOf($footer, 'menu'), 'props'), 'menu_id'));
        $this->assertContains('Information', array_column(array_column($this->elementsOf($footer, 'heading'), 'props'), 'text'));

        // Contexts the template is not made for.
        $this->instantiate('site-classic', 'cms')->assertUnprocessable()->assertJsonPath('error.code', 'TEMPLATE_NOT_ALLOWED');
        $this->instantiate('page-contact', 'page')->assertUnprocessable()->assertJsonPath('error.code', 'TEMPLATE_NOT_ALLOWED');
        $this->instantiate('vegan-hero-slider', 'header')->assertUnprocessable()->assertJsonPath('error.code', 'TEMPLATE_NOT_ALLOWED');
        $this->instantiate('no-such-template', 'page')->assertNotFound();
        $this->instantiate('vegan-hero-slider', 'nowhere')->assertUnprocessable();
    }

    public function test_own_templates_are_saved_applied_limited_and_deleted(): void
    {
        $section = [
            'id' => 's_mine', 'type' => 'section',
            'style' => ['base' => ['background' => ['type' => 'color', 'color' => '#fef3c7']]],
            'columns' => [['id' => 'c_mine', 'width' => ['base' => 100], 'elements' => [
                ['id' => 'e_title', 'type' => 'heading', 'props' => ['text' => 'Our promise', 'level' => 2], 'translations' => ['bn' => ['text' => 'আমাদের প্রতিশ্রুতি']]],
                ['id' => 'e_body', 'type' => 'text', 'props' => ['html' => '<p>Fresh <script>x()</script>every day.</p>']],
            ]]],
        ];
        $saved = $this->postJson(self::API.'/templates', ['name' => ' Promise band ', 'description' => 'Yellow band', 'scope' => 'section', 'context' => 'page', 'section' => $section])
            ->assertCreated()->json('data');
        $this->assertSame(['section', null, 'saved', 'Promise band', 'Yellow band', null, 'mine', []], [
            $saved['scope'], $saved['preset'], $saved['category'], $saved['name'], $saved['description'], $saved['thumbnail_url'], $saved['source'], $saved['requires'],
        ]);
        // Headings and text are allowed everywhere.
        $this->assertSame(['page', 'cms', 'header', 'footer', 'zone'], $saved['allowed_in']);
        $this->assertNotNull($saved['created_at']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_template_saved']);

        $mine = $this->getJson(self::API.'/templates?source=mine')->assertOk()->json('data');
        $this->assertSame([$saved['id']], array_column($mine, 'id'));
        $this->assertContains($saved['id'], array_column($this->getJson(self::API.'/templates?context=footer')->json('data'), 'id'));

        $applied = $this->instantiate($saved['id'], 'footer')->assertOk()->json('data');
        $this->assertSame('mine', $applied['template']['source']);
        $this->assertSame(['media' => 0, 'banners' => 0, 'banners_reused' => 0], $applied['imported']);
        $node = $applied['nodes'][0];
        $this->assertNotSame('s_mine', $node['id']);
        $this->assertSame('#fef3c7', $node['style']['base']['background']['color']);
        $this->assertSame('আমাদের প্রতিশ্রুতি', $node['columns'][0]['elements'][0]['translations']['bn']['text']);
        // Sanitized when saved.
        $this->assertStringNotContainsString('script', $node['columns'][0]['elements'][1]['props']['html']);

        // Invalid sections are refused like drafts; elements not allowed in the context too.
        $this->postJson(self::API.'/templates', ['name' => 'Bad', 'scope' => 'section', 'context' => 'page', 'section' => ['id' => 'x', 'columns' => []]])
            ->assertUnprocessable()->assertJsonPath('error.code', 'DOCUMENT_INVALID');
        $cart = $section;
        $cart['columns'][0]['elements'][] = ['id' => 'e_cart', 'type' => 'cart_icon', 'props' => []];
        $this->postJson(self::API.'/templates', ['name' => 'Cart', 'scope' => 'section', 'context' => 'page', 'section' => $cart])
            ->assertUnprocessable()->assertJsonPath('error.details.errors.0.code', 'ELEMENT_NOT_ALLOWED');
        $headerTemplate = $this->postJson(self::API.'/templates', ['name' => 'Cart row', 'scope' => 'section', 'context' => 'header', 'section' => $cart])->assertCreated()->json('data');
        $this->assertSame(['header'], $headerTemplate['allowed_in']);
        $this->instantiate($headerTemplate['id'], 'page')->assertUnprocessable()->assertJsonPath('error.code', 'TEMPLATE_NOT_ALLOWED');
        $this->postJson(self::API.'/templates', ['name' => 'X', 'scope' => 'page', 'context' => 'page', 'section' => $section])->assertUnprocessable();

        // A photo used by a saved template cannot be deleted from the media library.
        $photo = $this->elementsOf($this->instantiate('vegan-story', 'page')->json('data.nodes'), 'image')[0]['props']['media_id'];
        $withPhoto = $section;
        $withPhoto['columns'][0]['elements'][] = ['id' => 'e_photo', 'type' => 'image', 'props' => ['media_id' => $photo, 'alt' => 'Field']];
        $photoTemplate = $this->postJson(self::API.'/templates', ['name' => 'With photo', 'scope' => 'section', 'context' => 'page', 'section' => $withPhoto])->assertCreated()->json('data.id');
        $this->deleteJson("/api/v1/media/{$photo}")->assertStatus(422);

        // Too large: 256 KB of content.
        $big = ['id' => 's_big', 'type' => 'section', 'columns' => []];
        for ($c = 0; $c < 6; $c++) {
            $elements = [];
            for ($e = 0; $e < 40; $e++) {
                $elements[] = ['id' => "e_{$c}_{$e}", 'type' => 'text', 'props' => ['html' => '<p>'.str_repeat('a', 960).'</p>']];
            }
            $big['columns'][] = ['id' => "c_{$c}", 'width' => ['base' => 16], 'elements' => $elements];
        }
        $this->postJson(self::API.'/templates', ['name' => 'Big', 'scope' => 'section', 'context' => 'page', 'section' => $big])
            ->assertUnprocessable()->assertJsonPath('error.code', 'TEMPLATE_TOO_LARGE');

        // At most 100 per organization.
        $this->inTenant($this->t['organization'], function () {
            for ($i = BuilderTemplate::query()->count(); $i < 100; $i++) {
                BuilderTemplate::query()->create(['scope' => 'section', 'name' => "T{$i}", 'content' => ['context' => 'page', 'allowed_in' => ['page'], 'section' => []]]);
            }
        });
        $this->postJson(self::API.'/templates', ['name' => 'One more', 'scope' => 'section', 'context' => 'page', 'section' => $section])
            ->assertUnprocessable()->assertJsonPath('error.code', 'TEMPLATE_LIMIT_REACHED');

        // Delete own; built-ins cannot be deleted.
        $this->deleteJson(self::API."/templates/{$saved['id']}")->assertNoContent();
        $this->deleteJson(self::API."/templates/{$saved['id']}")->assertNotFound();
        $this->instantiate($saved['id'], 'page')->assertNotFound();
        $this->deleteJson(self::API.'/templates/vegan-hero-slider')->assertNotFound();
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_template_deleted']);
        $this->assertNotNull($photoTemplate);
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function presets(): array
    {
        return ['vegan' => ['vegan'], 'handmade' => ['handmade'], 'classic' => ['classic']];
    }

    #[DataProvider('presets')]
    public function test_start_from_demo_fills_drafts_only_until_publish_all(string $preset): void
    {
        $this->postJson('/api/v1/storefront/menus', ['name' => 'Main', 'location' => 'main'])->assertCreated();
        $this->postJson('/api/v1/storefront/menus', ['name' => 'Information', 'location' => 'footer_1'])->assertCreated();
        // A live home page and an open editor on it.
        $home = $this->createDoc('page', 'home', 'Home');
        $this->saveDraft($home, [['id' => 's_old', 'type' => 'section', 'columns' => [['id' => 'c_old', 'width' => ['base' => 100], 'elements' => [
            ['id' => 'e_old', 'type' => 'heading', 'props' => ['text' => 'My own home page']],
        ]]]]])->assertOk();
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();
        $editorRevision = $this->getJson(self::DOCS."/{$home}")->json('data.draft_revision');
        $liveTheme = $this->getJson(self::STORE.'/bootstrap')->assertOk()->json('data.theme.preset');

        $result = $this->postJson(self::API."/start-from-demo/{$preset}")->assertOk()->json('data');
        $this->assertSame($preset, $result['preset']);
        $this->assertSame(['home', 'header', 'footer', 'zone:listing.top'], array_column($result['documents'], 'key'));
        $this->assertSame($home, $result['documents'][0]['id']);
        foreach ($result['documents'] as $document) {
            $this->assertTrue($document['has_unpublished_changes']);
        }
        // Only the existing home page had a published version — still the same one.
        $this->assertSame([1, null, null, null], array_map(fn (array $d) => $d['published']['number'] ?? null, $result['documents']));
        $this->assertSame($preset, $result['theme']['preset']);
        $this->assertTrue($result['theme']['has_unpublished_changes']);
        $this->assertGreaterThan(0, $result['imported']['media']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_started_from_demo']);

        // The drafts hold the demo design; the theme draft is the preset (content kept).
        $draft = $this->getJson(self::DOCS."/{$home}")->assertOk()->json('data');
        $this->assertSame('hero_slider', $draft['content']['sections'][0]['columns'][0]['elements'][0]['type']);
        $themeDraft = $this->getJson('/api/v1/storefront/theme/draft')->assertOk()->json('data.settings');
        $this->assertSame(ThemePresets::all()[$preset]['colors'], array_intersect_key($themeDraft['colors'], ThemePresets::all()[$preset]['colors']));
        $header = BuilderDocument::query()->withoutGlobalScopes()->findOrFail($result['documents'][1]['id']);
        $this->assertNotEmpty($this->elementsOf($header->draft['sections'], 'menu'));

        // The open editor's next autosave conflicts instead of overwriting the demo draft.
        $this->putJson(self::DOCS."/{$home}/draft", ['revision' => $editorRevision, 'content' => ['schema_version' => 1, 'sections' => []]])
            ->assertStatus(409)->assertJsonPath('error.code', 'DRAFT_CONFLICT');

        // The live store has not changed.
        $this->app['auth']->forgetGuards();
        $live = $this->getJson(self::STORE.'/builder/pages/home')->assertOk()->json('data');
        $this->assertSame('My own home page', $live['sections'][0]['columns'][0]['elements'][0]['props']['text']);
        $bootstrap = $this->getJson(self::STORE.'/bootstrap')->assertOk()->json('data');
        $this->assertSame($liveTheme, $bootstrap['theme']['preset']);
        $this->assertNull($bootstrap['builder']['header']);
        $this->assertNull($bootstrap['builder']['footer']);
        $this->assertNull($bootstrap['builder']['zones']['listing.top']);

        // Publish all: every draft and the theme go live together.
        $this->actingAsUser($this->t['admin']);
        $published = $this->postJson(self::API.'/publish-all', ['documents' => array_column($result['documents'], 'id'), 'theme' => true, 'note' => 'Demo look'])
            ->assertOk()->json('data');
        $this->assertSame([2, 1, 1, 1], array_map(fn (array $d) => $d['published']['number'], $published['documents']));
        $this->assertFalse($published['theme']['has_unpublished_changes']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_published_all']);

        $this->app['auth']->forgetGuards();
        $live = $this->getJson(self::STORE.'/builder/pages/home')->assertOk()->json('data');
        $this->assertContains('hero_slider', array_column($this->elementsOf($live['sections']), 'type'));
        $this->assertNotContains('My own home page', array_column(array_column($this->elementsOf($live['sections']), 'props'), 'text'));
        $bootstrap = $this->getJson(self::STORE.'/bootstrap')->assertOk()->json('data');
        $this->assertSame($preset, $bootstrap['theme']['preset']);
        $this->assertNotNull($bootstrap['builder']['header']);
        $this->assertNotNull($bootstrap['builder']['footer']);
        $this->assertNotNull($bootstrap['builder']['zones']['listing.top']);

        // The previous live version is still in the history.
        $this->actingAsUser($this->t['admin']);
        $this->assertSame([2, 1], array_column($this->getJson(self::DOCS."/{$home}/versions")->json('data'), 'number'));
    }

    public function test_start_from_demo_can_leave_parts_out_and_runs_again_without_duplicates(): void
    {
        $org = $this->t['organization']->id;
        $result = $this->postJson(self::API.'/start-from-demo/classic', ['include' => ['theme' => false, 'header' => false, 'listing_top' => false]])->assertOk()->json('data');
        $this->assertSame(['home', 'footer'], array_column($result['documents'], 'key'));
        $this->assertNull($result['theme']);
        $this->assertFalse($this->getJson('/api/v1/storefront/theme/draft')->json('data.has_unpublished_changes'));
        [$media, $banners] = [$this->mediaCount($org), $this->bannerCount($org)];
        $this->assertSame(['banners' => 5, 'media' => 5], ['banners' => $banners, 'media' => $media]);

        $again = $this->postJson(self::API.'/start-from-demo/classic')->assertOk()->json('data');
        $this->assertSame(['home', 'header', 'footer', 'zone:listing.top'], array_column($again['documents'], 'key'));
        $this->assertSame(['media' => 0, 'banners' => 0, 'banners_reused' => 5], $again['imported']);
        $this->assertSame([$media, $banners], [$this->mediaCount($org), $this->bannerCount($org)]);
        $this->assertSame(1, BuilderDocument::query()->withoutGlobalScopes()->where('organization_id', $org)->where('key', 'home')->count());

        $this->postJson(self::API.'/start-from-demo/default')->assertNotFound();
        $this->postJson(self::API.'/start-from-demo/vegan', ['include' => ['logo' => true]])->assertUnprocessable();
    }

    public function test_publish_all_is_all_or_nothing_and_needs_the_publish_permission(): void
    {
        $home = $this->createDoc('page', 'home', 'Home');
        $this->saveDraft($home, [['id' => 's_a', 'type' => 'section', 'columns' => [['id' => 'c_a', 'width' => ['base' => 100], 'elements' => [
            ['id' => 'e_a', 'type' => 'heading', 'props' => ['text' => 'Hello']],
        ]]]]])->assertOk();
        $empty = $this->createDoc('page', 'landing:spring', 'Spring');

        // An empty page rolls the whole publish back.
        $this->postJson(self::API.'/publish-all', ['documents' => [$home, $empty], 'theme' => true])
            ->assertUnprocessable()->assertJsonPath('error.code', 'DOCUMENT_EMPTY');
        $this->assertNull($this->getJson(self::DOCS."/{$home}")->json('data.published'));
        $this->assertSame([], $this->getJson('/api/v1/storefront/theme/versions')->json('data'));

        $this->postJson(self::API.'/publish-all', ['documents' => []])->assertUnprocessable()->assertJsonPath('error.code', 'NOTHING_TO_PUBLISH');
        $this->postJson(self::API.'/publish-all', ['documents' => ['not-a-uuid']])->assertUnprocessable();
        $this->postJson(self::API.'/publish-all', ['documents' => [$home], 'theme' => false])->assertOk()
            ->assertJsonPath('data.documents.0.published.number', 1)->assertJsonPath('data.theme', null);

        // storefront.manage without storefront.publish: start from a demo yes, publish no.
        $this->userWith(['storefront.view', 'storefront.manage']);
        $docs = array_column($this->postJson(self::API.'/start-from-demo/handmade')->assertOk()->json('data.documents'), 'id');
        $this->postJson(self::API.'/publish-all', ['documents' => $docs, 'theme' => true])->assertForbidden();
        $this->getJson(self::API.'/templates')->assertOk();
        $this->instantiate('neutral-cta-band', 'page')->assertOk();

        // storefront.view only: list, nothing else.
        $this->userWith(['storefront.view']);
        $this->getJson(self::API.'/templates')->assertOk();
        $this->instantiate('neutral-cta-band', 'page')->assertForbidden();
        $this->postJson(self::API.'/start-from-demo/vegan')->assertForbidden();
        $this->postJson(self::API.'/templates', ['name' => 'X', 'scope' => 'section', 'context' => 'page', 'section' => []])->assertForbidden();

        // Cashiers see nothing.
        $this->actingAsUser($this->createUserWithRole($this->t['organization'], SystemRole::Cashier));
        $this->getJson(self::API.'/templates')->assertForbidden();

        // The online store manager publishes them all.
        $this->actingAsUser($this->createUserWithRole($this->t['organization'], SystemRole::OnlineStoreManager));
        $this->postJson(self::API.'/publish-all', ['documents' => $docs, 'theme' => true])->assertOk()->assertJsonPath('data.theme.preset', 'handmade');
    }

    public function test_tenant_isolation(): void
    {
        RateLimiter::for('builder-templates', fn () => Limit::none());
        $berry = $this->t;
        $section = ['id' => 's_x', 'type' => 'section', 'columns' => [['id' => 'c_x', 'width' => ['base' => 100], 'elements' => [
            ['id' => 'e_x', 'type' => 'heading', 'props' => ['text' => 'Berry secret']],
        ]]]];
        $berryTemplate = $this->postJson(self::API.'/templates', ['name' => 'Berry band', 'scope' => 'section', 'context' => 'page', 'section' => $section])->assertCreated()->json('data.id');
        $berryHome = array_column($this->postJson(self::API.'/start-from-demo/vegan')->assertOk()->json('data.documents'), 'id', 'key')['home'];
        $berryBanners = $this->bannerCount($berry['organization']->id);
        $berryMedia = $this->mediaCount($berry['organization']->id);

        $other = $this->openStore('Olive Tree', 'olive.test');
        // Another organization's templates are invisible and cannot be applied or deleted.
        $this->assertSame([], $this->getJson(self::API.'/templates?source=mine')->assertOk()->json('data'));
        $this->assertNotContains($berryTemplate, array_column($this->getJson(self::API.'/templates')->json('data'), 'id'));
        $this->instantiate($berryTemplate, 'page')->assertNotFound();
        $this->deleteJson(self::API."/templates/{$berryTemplate}")->assertNotFound();
        // Nor can its documents be published.
        $this->postJson(self::API.'/publish-all', ['documents' => [$berryHome]])->assertUnprocessable()->assertJsonPath('error.code', 'DOCUMENTS_NOT_FOUND');
        $this->assertNull(BuilderDocument::query()->withoutGlobalScopes()->findOrFail($berryHome)->published_version_id);

        // Applying the same templates imports the photos and creates the banners in its own organization.
        $result = $this->postJson(self::API.'/start-from-demo/vegan')->assertOk()->json('data');
        $this->assertSame($berryMedia, $result['imported']['media']);
        $this->assertSame($berryBanners, $result['imported']['banners']);
        $this->assertSame($berryMedia, $this->mediaCount($other['organization']->id));
        $this->assertSame($berryBanners, $this->bannerCount($other['organization']->id));
        $this->assertSame([$berryMedia, $berryBanners], [$this->mediaCount($berry['organization']->id), $this->bannerCount($berry['organization']->id)]);
        $oliveHome = BuilderDocument::query()->withoutGlobalScopes()->findOrFail(array_column($result['documents'], 'id', 'key')['home']);
        $this->assertSame($other['organization']->id, $oliveHome->organization_id);
        $hero = $this->elementsOf($oliveHome->draft['sections'], 'hero_slider')[0];
        $this->assertSame(
            [$other['organization']->id],
            Banner::query()->withoutGlobalScopes()->whereIn('id', array_column($hero['props']['items'], 'item_id'))->distinct()->pluck('organization_id')->all(),
        );
        $this->assertNotSame($berryHome, $oliveHome->id);

        // Its own saved template only.
        $own = $this->postJson(self::API.'/templates', ['name' => 'Olive band', 'scope' => 'section', 'context' => 'page', 'section' => $section])->assertCreated()->json('data.id');
        $this->assertSame([$own], array_column($this->getJson(self::API.'/templates?source=mine')->json('data'), 'id'));
        $this->actingAsUser($berry['admin']);
        $this->assertSame([$berryTemplate], array_column($this->getJson(self::API.'/templates?source=mine')->json('data'), 'id'));
        $this->instantiate($own, 'page')->assertNotFound();
        $this->deleteJson(self::API."/templates/{$own}")->assertNotFound();
        $this->postJson(self::API.'/publish-all', ['documents' => [$oliveHome->id]])->assertUnprocessable()->assertJsonPath('error.code', 'DOCUMENTS_NOT_FOUND');
    }
}
