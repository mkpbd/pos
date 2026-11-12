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
 * B1: the visual store builder engine — documents, draft / publish / versions, the public
 * page endpoints, the homepage importer, permissions and tenant isolation.
 */
class StoreBuilderTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

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

    /**
     * The shared sample document with the organization's own banner and image.
     *
     * @return array<string, mixed>
     */
    private function sample(string $bannerId, string $mediaId): array
    {
        $json = (string) file_get_contents(base_path('../frontend/src/storefront/builder/__fixtures__/sample-document.v1.json'));
        $json = str_replace(['01a1c9d9-0000-7000-8000-000000000001', '01a1c9d9-0000-7000-8000-000000000002'], [$bannerId, $mediaId], $json);

        return json_decode($json, true, flags: JSON_THROW_ON_ERROR);
    }

    private function createPage(string $key = 'home', string $title = 'Home', string $from = 'blank'): string
    {
        return $this->postJson(self::DOCS, ['kind' => 'page', 'key' => $key, 'title' => $title, 'from' => $from])->assertCreated()->json('data.id');
    }

    /**
     * @param  array<string, mixed>  $content
     */
    private function saveDraft(string $id, array $content): int
    {
        $revision = $this->getJson(self::DOCS."/{$id}")->assertOk()->json('data.draft_revision');

        return $this->putJson(self::DOCS."/{$id}/draft", ['revision' => $revision, 'content' => $content])->assertOk()->json('data.draft_revision');
    }

    private function asVisitor(): void
    {
        $this->app['auth']->forgetGuards();
    }

    /**
     * A one-section document holding the given elements.
     *
     * @param  list<array<string, mixed>>  $elements
     * @return array<string, mixed>
     */
    private function page(array $elements, array $section = []): array
    {
        return ['schema_version' => 1, 'sections' => [$section + [
            'id' => 's_main', 'type' => 'section',
            'columns' => [['id' => 'c_main', 'width' => ['base' => 100], 'elements' => $elements]],
        ]]];
    }

    public function test_documents_are_created_listed_validated_and_deleted(): void
    {
        $this->store('Berry Kids', 'berry.test');

        $home = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home'])->assertCreated()
            ->assertJsonPath('data.key', 'home')
            ->assertJsonPath('data.kind', 'page')
            ->assertJsonPath('data.schema_version', 1)
            ->assertJsonPath('data.draft_revision', 0)
            ->assertJsonPath('data.has_unpublished_changes', true)
            ->assertJsonPath('data.published', null)
            ->assertJsonPath('data.content', ['schema_version' => 1, 'sections' => []])
            ->json('data.id');
        $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Again'])->assertStatus(409)->assertJsonPath('error.code', 'DOCUMENT_EXISTS');
        $landing = $this->createPage('landing:eid-sale', 'Eid sale');
        $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:eid-sale', 'title' => 'Twice'])->assertStatus(409)->assertJsonPath('error.code', 'DOCUMENT_EXISTS');

        foreach ([
            // B4: header documents exist now, but their key must match their kind.
            ['kind' => 'header', 'key' => 'landing:top', 'title' => 'Header'],
            ['kind' => 'theme', 'key' => 'theme', 'title' => 'Theme'],
            ['kind' => 'page', 'key' => 'landing:home', 'title' => 'Reserved'],
            ['kind' => 'page', 'key' => 'landing:Eid Sale', 'title' => 'Bad slug'],
            ['kind' => 'page', 'key' => 'cms:about', 'title' => 'Later'],
            ['kind' => 'page', 'key' => 'landing:x', 'title' => 'Too short'],
            ['kind' => 'page', 'key' => 'landing:ok-page', 'title' => 'From where', 'from' => 'template'],
        ] as $payload) {
            $this->postJson(self::DOCS, $payload)->assertUnprocessable()->assertJsonPath('error.code', 'VALIDATION_FAILED');
        }

        $this->assertSame(['home', 'landing:eid-sale'], array_column($this->getJson(self::DOCS)->assertOk()->json('data'), 'key'));
        $this->getJson(self::DOCS."/{$landing}")->assertOk()->assertJsonPath('data.title', 'Eid sale');

        $this->deleteJson(self::DOCS."/{$home}")->assertUnprocessable()->assertJsonPath('error.code', 'CANNOT_DELETE_HOME');
        $this->deleteJson(self::DOCS."/{$landing}")->assertNoContent();
        $this->getJson(self::DOCS."/{$landing}")->assertNotFound();
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_created']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_deleted']);

        $elements = $this->getJson('/api/v1/storefront/builder/elements')->assertOk();
        $this->assertContains('product_grid', array_column($elements->json('data.types'), 'type'));
        $this->assertStringContainsString('"type":"spacer","group":"layout","label":"Spacer","translatable":[],"props":{}', (string) $elements->getContent());
    }

    public function test_draft_saves_are_normalized_checked_and_conflict_safe(): void
    {
        $this->store('Berry Kids', 'berry.test');
        $sample = $this->sample($this->banner('hero_slider', 'Hero'), $this->image('veg.jpg'));
        $home = $this->createPage();

        $saved = $this->putJson(self::DOCS."/{$home}/draft", ['revision' => 0, 'content' => $sample])->assertOk()
            ->assertJsonPath('data.draft_revision', 1)
            ->assertJsonPath('data.content.sections.1.columns.0.elements.1.props.html', '<p>Small batches, local farms and <strong>no shortcuts</strong>.</p>');
        // Empty objects stay objects.
        $this->assertStringContainsString('"translations":{}', (string) $saved->getContent());
        $this->assertStringNotContainsString('"style":[]', (string) $saved->getContent());
        $this->assertEquals($sample, json_decode((string) json_encode($saved->json('data.content')), true));

        // A second tab still on revision 0 is refused with the current revision.
        $this->putJson(self::DOCS."/{$home}/draft", ['revision' => 0, 'content' => $sample])->assertStatus(409)
            ->assertJsonPath('error.code', 'DRAFT_CONFLICT')->assertJsonPath('error.details.revision', 1);

        // Structure problems name the node and its path; nothing is saved.
        $bad = $sample;
        $bad['sections'][1]['columns'][0]['elements'][2]['props']['link']['url'] = 'javascript:alert(1)';
        $bad['sections'][2]['columns'][0]['elements'][0]['columns'][0]['elements'][] = ['id' => 'e_deep', 'type' => 'inner_row', 'columns' => []];
        $errors = $this->putJson(self::DOCS."/{$home}/draft", ['revision' => 1, 'content' => $bad])->assertUnprocessable()
            ->assertJsonPath('error.code', 'DOCUMENT_INVALID')->json('error.details.errors');
        $this->assertEqualsCanonicalizing(['e_button', 'e_deep'], array_column($errors, 'node_id'));
        $this->assertContains('sections.1.columns.0.elements.2.props.link.url', array_column($errors, 'path'));

        // Rich text is sanitized on save; a text block with nothing left is refused.
        $page = $this->page([
            ['id' => 'e_text', 'type' => 'text', 'props' => ['html' => '<p onclick="x()">Hi <script>alert(1)</script><b>there</b></p>'], 'translations' => ['bn' => ['html' => '<script>x</script>']]],
            ['id' => 'e_block', 'type' => 'rich_text', 'props' => ['config' => ['body_html' => '<h2>Fresh</h2>']], 'translations' => ['bn' => ['body_html' => '<h2 style="color:red">তাজা</h2>']]],
        ]);
        $content = $this->putJson(self::DOCS."/{$home}/draft", ['revision' => 1, 'content' => $page])->assertOk()->json('data.content.sections.0.columns.0.elements');
        $this->assertSame('<p>Hi there</p>', $content[0]['props']['html']);
        $this->assertSame([], $content[0]['translations']);
        $this->assertSame(['bn' => ['body_html' => '<h2>তাজা</h2>']], $content[1]['translations']);
        $page['sections'][0]['columns'][0]['elements'][1]['props']['config']['body_html'] = '<script>alert(1)</script>';
        $this->putJson(self::DOCS."/{$home}/draft", ['revision' => 2, 'content' => $page])->assertUnprocessable()
            ->assertJsonPath('error.details.errors.0.path', 'sections.0.columns.0.elements.1.props.config.body_html');
    }

    public function test_references_must_belong_to_the_organization(): void
    {
        ['admin' => $berryAdmin] = $this->store('Berry Kids', 'berry.test');
        $berryImage = $this->image('berry.jpg');
        $berryBanner = $this->banner('hero_slider', 'Berry hero');
        $berryTile = $this->banner('home_promo', 'Berry tile');

        $this->store('Tiny Toes', 'tiny.test');
        $home = $this->createPage();
        $ownBanner = $this->banner('hero_slider', 'Tiny hero');

        $page = $this->page([
            ['id' => 'e_img', 'type' => 'image', 'props' => ['media_id' => $berryImage, 'alt' => 'Not ours']],
            ['id' => 'e_slider', 'type' => 'hero_slider', 'props' => ['items' => [['item_type' => 'banner', 'item_id' => $berryBanner], ['item_type' => 'banner', 'item_id' => $ownBanner]]]],
            ['id' => 'e_wrong', 'type' => 'hero_slider', 'props' => ['items' => [['item_type' => 'banner', 'item_id' => $berryTile]]]],
            ['id' => 'e_grid', 'type' => 'product_grid', 'props' => ['config' => ['source' => 'manual'], 'items' => [['item_type' => 'product', 'item_id' => '01900000-0000-7000-8000-000000000001']]]],
            ['id' => 'e_deals', 'type' => 'hot_deals', 'props' => ['config' => ['promotion_id' => '01900000-0000-7000-8000-000000000002']]],
        ], ['style' => ['base' => ['background' => ['type' => 'image', 'image' => ['media_id' => $berryImage]]]]]);

        $errors = $this->putJson(self::DOCS."/{$home}/draft", ['revision' => 0, 'content' => $page])->assertUnprocessable()
            ->assertJsonPath('error.code', 'DOCUMENT_INVALID')->json('error.details.errors');
        $byNode = [];
        foreach ($errors as $error) {
            $byNode[$error['node_id']][] = $error;
        }
        $this->assertSame('MEDIA_NOT_FOUND', $byNode['s_main'][0]['code']);
        $this->assertSame('sections.0.style', $byNode['s_main'][0]['path']);
        $this->assertSame([$berryImage], $byNode['e_img'][0]['ids']);
        $this->assertSame(['BANNER_NOT_FOUND', [$berryBanner]], [$byNode['e_slider'][0]['code'], $byNode['e_slider'][0]['ids']]);
        $this->assertSame('BANNER_NOT_FOUND', $byNode['e_wrong'][0]['code']);
        $this->assertSame('PRODUCT_NOT_FOUND', $byNode['e_grid'][0]['code']);
        $this->assertSame('PROMOTION_NOT_FOUND', $byNode['e_deals'][0]['code']);

        // Media in a builder page cannot be deleted from the library.
        $this->actingAsUser($berryAdmin);
        $berryHome = $this->createPage();
        $this->saveDraft($berryHome, $this->page([['id' => 'e_img', 'type' => 'image', 'props' => ['media_id' => $berryImage]]]));
        $this->deleteJson("/api/v1/media/{$berryImage}")->assertUnprocessable()->assertJsonPath('error.code', 'IN_USE');
    }

    public function test_draft_is_not_live_until_published_and_versions_restore(): void
    {
        ['admin' => $admin] = $this->store('Berry Kids', 'berry.test');
        $home = $this->createPage();
        $this->saveDraft($home, $this->page([['id' => 'e_title', 'type' => 'heading', 'props' => ['text' => 'Version one']]]));

        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/builder/pages/home')->assertNotFound()->assertJsonPath('error.code', 'PAGE_NOT_FOUND');
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()->assertJsonPath('data.builder', [
            'home' => false,
            // B4: no builder header, footer or zones — the classic rendering.
            'header' => null,
            'footer' => null,
            'zones' => ['listing.top' => null, 'listing.bottom' => null, 'product.after' => null],
        ]);

        $this->actingAsUser($admin);
        $this->postJson(self::DOCS."/{$home}/discard")->assertStatus(409)->assertJsonPath('error.code', 'NOTHING_PUBLISHED');
        $this->getJson(self::DOCS."/{$home}/render?source=published")->assertStatus(409)->assertJsonPath('error.code', 'NOTHING_PUBLISHED');

        $first = $this->postJson(self::DOCS."/{$home}/publish", ['note' => 'Launch'])->assertOk()
            ->assertJsonPath('data.published.number', 1)
            ->assertJsonPath('data.has_unpublished_changes', false)
            ->json('data.published.version_id');
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_published']);

        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/builder/pages/home')->assertOk()
            ->assertJsonPath('data.document.version', 1)
            ->assertJsonPath('data.document.source', 'published')
            ->assertJsonPath('data.sections.0.columns.0.elements.0.props.text', 'Version one');
        // Publishing refreshed the cached bootstrap.
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertJsonPath('data.builder.home', true);

        // A saved draft changes nothing for shoppers.
        $this->actingAsUser($admin);
        $this->saveDraft($home, $this->page([['id' => 'e_title', 'type' => 'heading', 'props' => ['text' => 'Version two']]]));
        $this->getJson(self::DOCS)->assertJsonPath('data.0.has_unpublished_changes', true);
        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/builder/pages/home')->assertJsonPath('data.sections.0.columns.0.elements.0.props.text', 'Version one');

        $this->actingAsUser($admin);
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk()->assertJsonPath('data.published.number', 2);
        $versions = $this->getJson(self::DOCS."/{$home}/versions")->assertOk()->json('data');
        $this->assertSame([2, 1], array_column($versions, 'number'));
        $this->assertSame(['Launch'], array_values(array_filter(array_column($versions, 'note'))));
        $this->assertSame($admin->id, $versions[0]['created_by']['id']);
        $this->assertSame($admin->name, $versions[0]['created_by']['name']);

        // Restore v1: draft only, then live after publishing (as v3).
        $restored = $this->postJson(self::DOCS."/{$home}/versions/{$first}/restore")->assertOk()
            ->assertJsonPath('data.content.sections.0.columns.0.elements.0.props.text', 'Version one')
            ->assertJsonPath('data.has_unpublished_changes', true);
        $this->assertSame(3, $restored->json('data.draft_revision'));
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_restored']);
        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/builder/pages/home')->assertJsonPath('data.sections.0.columns.0.elements.0.props.text', 'Version two');
        $this->actingAsUser($admin);
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk()->assertJsonPath('data.published.number', 3);
        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/builder/pages/home')->assertJsonPath('data.document.version', 3)
            ->assertJsonPath('data.sections.0.columns.0.elements.0.props.text', 'Version one');

        // Discard: the draft goes back to the live content.
        $this->actingAsUser($admin);
        $this->saveDraft($home, $this->page([['id' => 'e_title', 'type' => 'heading', 'props' => ['text' => 'Scrap this']]]));
        $this->postJson(self::DOCS."/{$home}/discard")->assertOk()
            ->assertJsonPath('data.content.sections.0.columns.0.elements.0.props.text', 'Version one')
            ->assertJsonPath('data.has_unpublished_changes', false);
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_discarded']);

        // Admin render of both sources.
        $this->getJson(self::DOCS."/{$home}/render?source=published")->assertOk()->assertJsonPath('data.document.source', 'published')->assertJsonPath('data.document.version', 3);
        $this->getJson(self::DOCS."/{$home}/render")->assertOk()->assertJsonPath('data.document.source', 'draft')->assertJsonPath('data.document.version', null);
        $this->getJson(self::DOCS."/{$home}/render?source=live")->assertUnprocessable();

        // Landing pages publish on their own slug.
        $landing = $this->createPage('landing:eid-sale', 'Eid sale');
        $this->postJson(self::DOCS."/{$landing}/publish")->assertUnprocessable()->assertJsonPath('error.code', 'DOCUMENT_EMPTY');
        $this->saveDraft($landing, $this->page([['id' => 'e_title', 'type' => 'heading', 'props' => ['text' => 'Eid deals']]]));
        $this->postJson(self::DOCS."/{$landing}/publish")->assertOk();
        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/builder/pages/eid-sale')->assertOk()->assertJsonPath('data.document.key', 'landing:eid-sale');
        $this->getJson('http://berry.test/api/v1/store/builder/pages/other-page')->assertNotFound();

        // Deleting a published landing page takes it off the store at once.
        $this->actingAsUser($admin);
        $this->deleteJson(self::DOCS."/{$landing}")->assertNoContent();
        $this->assertDatabaseMissing('builder_versions', ['document_id' => $landing]);
        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/builder/pages/eid-sale')->assertNotFound();
    }

    public function test_render_payload_filters_localizes_and_resolves_media_and_section_data(): void
    {
        ['organization' => $org, 'admin' => $admin] = $this->store('Berry Kids', 'berry.test');
        $banner = $this->banner('hero_slider', 'Hero', ['kicker' => 'Online', 'translations' => ['bn' => ['title' => 'বাংলা শিরোনাম']]]);
        $image = $this->image('veg.jpg');
        $sample = $this->sample($banner, $image);
        // Scheduled and expired sections next to the fixture's hidden one.
        $sample['sections'][] = ['id' => 's_soon', 'type' => 'section', 'schedule' => ['starts_at' => '2026-12-01T00:00:00+06:00', 'ends_at' => null],
            'columns' => [['id' => 'c_soon', 'width' => ['base' => 100], 'elements' => [['id' => 'e_soon', 'type' => 'spacer']]]]];
        $sample['sections'][] = ['id' => 's_over', 'type' => 'section', 'schedule' => ['starts_at' => null, 'ends_at' => '2026-11-01T00:00:00+06:00'],
            'columns' => [['id' => 'c_over', 'width' => ['base' => 100], 'elements' => [['id' => 'e_over', 'type' => 'spacer']]]]];
        $home = $this->createPage();
        $this->saveDraft($home, $sample);
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();
        // The homepage section API shows the same hero slider.
        $this->postJson('/api/v1/storefront/homepage-sections', ['type' => 'hero_slider', 'banner_ids' => [$banner]])->assertCreated();
        $this->asVisitor();

        $page = $this->getJson('http://berry.test/api/v1/store/builder/pages/home')->assertOk();
        // Hidden, not-yet-started and ended sections are left out; the product grid without
        // products drops out, and with it its section (no empty band on the page).
        $this->assertSame(['s_hero', 's_story', 's_features'], array_column($page->json('data.sections'), 'id'));
        $this->assertStringNotContainsString('"translations"', (string) $page->getContent());
        $this->assertStringNotContainsString('"state"', (string) $page->getContent());
        $page->assertJsonPath('data.sections.1.columns.0.elements.0.props.text', 'Made fresh every morning')
            ->assertJsonPath('data.sections.1.props.anchor', 'our-story')
            ->assertJsonPath('data.sections.2.columns.0.elements.0.columns.1.elements.0.visibility.mobile', false)
            ->assertJsonPath("data.media.{$image}.width", 1600)
            ->assertJsonMissingPath("data.media.{$image}.id")
            ->assertJsonMissingPath('data.data.e_grid');
        $this->assertStringContainsString('"type":"spacer","props":{}', (string) $page->getContent());

        $homepage = $this->getJson('http://berry.test/api/v1/store/homepage')->assertOk()->json('data.sections.0');
        $this->assertSame(array_merge($homepage, ['id' => 'e_slider']), $page->json('data.data.e_slider'));

        // Bangla: translatable props and the wrapped section data.
        $bn = $this->getJson('http://berry.test/api/v1/store/builder/pages/home?lang=bn')->assertOk()
            ->assertJsonPath('data.sections.1.columns.0.elements.0.props.text', 'প্রতিদিন সকালে তাজা তৈরি')
            ->assertJsonPath('data.sections.1.columns.0.elements.2.props.label', 'এখনই কিনুন')
            ->assertJsonPath('data.sections.1.columns.1.elements.0.props.alt', 'টেবিলে তাজা সবজি')
            ->assertJsonPath('data.data.e_slider.banners.0.title', 'বাংলা শিরোনাম');
        $this->assertSame('bn', $bn->headers->get('Content-Language'));
        $this->assertSame(array_merge($this->getJson('http://berry.test/api/v1/store/homepage?lang=bn')->json('data.sections.0'), ['id' => 'e_slider']), $bn->json('data.data.e_slider'));

        // Schedules follow the clock.
        Date::setTestNow('2026-12-02T10:00:00+06:00');
        $this->assertContains('s_soon', array_column($this->getJson('http://berry.test/api/v1/store/builder/pages/home')->json('data.sections'), 'id'));

        // A section left empty on purpose stays (only sections whose elements all dropped out go).
        Date::setTestNow('2026-11-11T10:00:00+06:00');
        $this->actingAsUser($admin);
        $sample['sections'][] = ['id' => 's_blank', 'type' => 'section', 'columns' => [['id' => 'c_blank', 'width' => ['base' => 100], 'elements' => []]]];
        $this->saveDraft($home, $sample);
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();
        $this->asVisitor();
        $this->assertContains('s_blank', array_column($this->getJson('http://berry.test/api/v1/store/builder/pages/home')->json('data.sections'), 'id'));

        // Staff draft preview keeps everything with its state.
        Date::setTestNow('2026-11-11T10:00:00+06:00');
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::OnlineStoreManager));
        $preview = $this->getJson('http://berry.test/api/v1/store/builder/pages/home?preview=draft')->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('data.document.source', 'draft');
        $states = array_column($preview->json('data.sections'), 'state', 'id');
        $this->assertSame(['s_hidden' => 'hidden', 's_soon' => 'scheduled', 's_over' => 'expired'], $states);
        $preview->assertJsonPath('data.sections.3.columns.0.elements.0.state', 'empty')
            ->assertJsonPath('data.data.e_grid.state', 'empty')
            ->assertJsonPath('data.data.e_slider.state', 'live');

        // The admin render shows the same in Bangla.
        $this->actingAsUser($admin);
        $this->getJson(self::DOCS."/{$home}/render?lang=bn")->assertOk()
            ->assertJsonPath('data.sections.1.columns.0.elements.0.props.text', 'প্রতিদিন সকালে তাজা তৈরি')
            ->assertJsonPath('data.sections.4.state', 'hidden');
    }

    public function test_importer_reproduces_the_current_homepage(): void
    {
        $this->store('Berry Kids', 'berry.test');
        $hero = $this->banner('hero_slider', 'Eid', ['kicker' => 'Online', 'link_url' => '/sale', 'button_label' => 'Shop now']);
        $tiles = [$this->banner('home_promo', 'T1'), $this->banner('home_promo', 'T2')];
        $sections = [
            ['type' => 'hero_slider', 'banner_ids' => [$hero]],
            ['type' => 'banner_grid', 'config' => ['layout' => '2-col'], 'banner_ids' => $tiles],
            ['type' => 'rich_text', 'title' => 'About', 'config' => ['body_html' => '<p>Hello</p>'], 'translations' => ['bn' => ['title' => 'সম্পর্কে', 'body_html' => '<p>হ্যালো</p>']]],
            ['type' => 'features_strip', 'title' => 'Why us', 'config' => ['items' => [['icon' => 'truck', 'title' => 'Fast delivery', 'text' => 'Dhaka in 24h']]]],
            ['type' => 'newsletter', 'title' => 'Hidden', 'is_enabled' => false],
            ['type' => 'newsletter', 'title' => 'Later', 'starts_at' => '2026-12-05T00:00:00+06:00'],
            ['type' => 'testimonials', 'config' => ['items' => [['quote' => 'Lovely', 'name' => 'Rina', 'rating' => 5, 'avatar_media_id' => $this->image('a.png')]]]],
            ['type' => 'product_carousel', 'title' => 'Nothing yet'],
        ];
        foreach ($sections as $section) {
            $this->postJson('/api/v1/storefront/homepage-sections', $section)->assertCreated();
        }

        $created = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home', 'from' => 'homepage'])->assertCreated();
        $content = $created->json('data.content');
        $this->assertCount(8, $content['sections']);
        $this->assertSame(array_fill(0, 8, 'full-bleed'), array_column(array_column($content['sections'], 'props'), 'layout'));
        $this->assertSame([false, false, false, false, true, false, false, false], array_column($content['sections'], 'hidden'));
        $this->assertNotNull($content['sections'][5]['schedule']['starts_at']);
        $element = $content['sections'][2]['columns'][0]['elements'][0];
        $this->assertSame(['rich_text', 'About', ['bn' => ['title' => 'সম্পর্কে', 'body_html' => '<p>হ্যালো</p>']]], [$element['type'], $element['props']['title'], $element['translations']]);
        $this->assertSame([['item_type' => 'banner', 'item_id' => $hero]], $content['sections'][0]['columns'][0]['elements'][0]['props']['items']);
        $this->assertSame(100, $content['sections'][0]['columns'][0]['width']['base']);

        $this->postJson(self::DOCS.'/'.$created->json('data.id').'/publish')->assertOk();
        $this->asVisitor();
        foreach (['en', 'bn'] as $lang) {
            $legacy = array_map(fn (array $s) => array_diff_key($s, ['id' => true]), $this->getJson("http://berry.test/api/v1/store/homepage?lang={$lang}")->json('data.sections'));
            $builder = array_map(fn (array $s) => array_diff_key($s, ['id' => true]), array_values($this->getJson("http://berry.test/api/v1/store/builder/pages/home?lang={$lang}")->assertOk()->json('data.data')));
            $this->assertCount(5, $legacy);
            $this->assertSame($legacy, $builder, $lang);
        }

        // The scheduled section appears on both at the same moment.
        Date::setTestNow('2026-12-06T10:00:00+06:00');
        $this->assertCount(6, $this->getJson('http://berry.test/api/v1/store/homepage')->json('data.sections'));
        $this->assertCount(6, (array) $this->getJson('http://berry.test/api/v1/store/builder/pages/home')->json('data.data'));
    }

    public function test_preview_and_permissions(): void
    {
        ['organization' => $org, 'admin' => $admin] = $this->store('Berry Kids', 'berry.test');
        ['admin' => $otherAdmin] = $this->store('Tiny Toes', 'tiny.test');
        $this->actingAsUser($admin);
        $home = $this->createPage();
        $this->saveDraft($home, $this->page([['id' => 'e_title', 'type' => 'heading', 'props' => ['text' => 'Draft only']]]));

        // Unpublished: the draft preview needs staff of this store with storefront.view.
        $this->getJson('http://berry.test/api/v1/store/builder/pages/home?preview=draft')->assertOk()->assertJsonPath('data.document.source', 'draft');
        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/builder/pages/home?preview=draft')->assertNotFound();
        $this->actingAsUser($otherAdmin);
        $this->getJson('http://berry.test/api/v1/store/builder/pages/home?preview=draft')->assertNotFound();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);
        $this->actingAsUser($cashier);
        $this->getJson('http://berry.test/api/v1/store/builder/pages/home?preview=draft')->assertNotFound();

        // Cashiers have no builder access at all.
        $this->getJson(self::DOCS)->assertForbidden();
        $this->getJson('/api/v1/storefront/builder/elements')->assertForbidden();
        $this->getJson(self::DOCS."/{$home}/render")->assertForbidden();

        // storefront.manage without storefront.publish edits but cannot publish.
        $this->actingAsUser($admin);
        $roleId = $this->postJson('/api/v1/roles', ['name' => 'Editor', 'permissions' => ['storefront.view', 'storefront.manage']])->assertCreated()->json('data.id');
        $editor = $this->createUserWithRole($org, $this->inTenant($org, fn () => Role::query()->findOrFail($roleId)));
        $this->actingAsUser($editor);
        $this->saveDraft($home, $this->page([['id' => 'e_title', 'type' => 'heading', 'props' => ['text' => 'Edited']]]));
        $this->postJson(self::DOCS."/{$home}/publish")->assertForbidden();
        $this->actingAsUser($admin);
        $viewerRoleId = $this->postJson('/api/v1/roles', ['name' => 'Store viewer', 'permissions' => ['storefront.view']])->assertCreated()->json('data.id');
        $viewer = $this->createUserWithRole($org, $this->inTenant($org, fn () => Role::query()->findOrFail($viewerRoleId)));
        $this->actingAsUser($viewer);
        $this->getJson(self::DOCS."/{$home}")->assertOk();
        $this->getJson(self::DOCS."/{$home}/versions")->assertOk();
        $this->putJson(self::DOCS."/{$home}/draft", ['revision' => 2, 'content' => $this->page([])])->assertForbidden();
        $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:x-page', 'title' => 'X'])->assertForbidden();

        // The online store manager role publishes (storefront.publish by default).
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::OnlineStoreManager));
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk()->assertJsonPath('data.published.number', 1);
    }

    public function test_tenant_isolation_on_every_endpoint(): void
    {
        ['admin' => $berryAdmin] = $this->store('Berry Kids', 'berry.test');
        $berryHome = $this->createPage();
        $this->saveDraft($berryHome, $this->page([['id' => 'e_title', 'type' => 'heading', 'props' => ['text' => 'Berry only']]]));
        $berryVersion = $this->postJson(self::DOCS."/{$berryHome}/publish")->assertOk()->json('data.published.version_id');

        ['admin' => $tinyAdmin] = $this->store('Tiny Toes', 'tiny.test');
        $this->actingAsUser($tinyAdmin);
        $this->getJson(self::DOCS)->assertOk()->assertJsonCount(0, 'data');
        $this->getJson(self::DOCS."/{$berryHome}")->assertNotFound();
        $this->putJson(self::DOCS."/{$berryHome}/draft", ['revision' => 1, 'content' => $this->page([])])->assertNotFound();
        $this->postJson(self::DOCS."/{$berryHome}/publish")->assertNotFound();
        $this->postJson(self::DOCS."/{$berryHome}/discard")->assertNotFound();
        $this->getJson(self::DOCS."/{$berryHome}/versions")->assertNotFound();
        $this->postJson(self::DOCS."/{$berryHome}/versions/{$berryVersion}/restore")->assertNotFound();
        $this->getJson(self::DOCS."/{$berryHome}/render")->assertNotFound();
        $this->deleteJson(self::DOCS."/{$berryHome}")->assertNotFound();

        // Tiny's own home cannot restore Berry's version, and its key space is its own.
        $tinyHome = $this->createPage();
        $this->postJson(self::DOCS."/{$tinyHome}/versions/{$berryVersion}/restore")->assertNotFound();

        // Tiny's public host never serves Berry's page.
        $this->asVisitor();
        $this->getJson('http://tiny.test/api/v1/store/builder/pages/home')->assertNotFound();
        $this->getJson('http://tiny.test/api/v1/store/bootstrap')->assertJsonPath('data.builder.home', false);
        $this->getJson('http://berry.test/api/v1/store/builder/pages/home')->assertOk()->assertJsonPath('data.document.id', $berryHome);

        // Berry's admin sees Berry's page unchanged.
        $this->actingAsUser($berryAdmin);
        $this->getJson(self::DOCS)->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $berryHome);
        $this->getJson(self::DOCS."/{$berryHome}")->assertJsonPath('data.draft_revision', 1);

        // A version of another document of the same organization does not restore either.
        $landing = $this->createPage('landing:sale', 'Sale');
        $this->postJson(self::DOCS."/{$landing}/versions/{$berryVersion}/restore")->assertNotFound();
    }

    public function test_public_page_caching_and_landing_shell(): void
    {
        ['admin' => $admin] = $this->store('Berry Kids', 'berry.test');
        $home = $this->createPage();
        $this->saveDraft($home, $this->page([['id' => 'e_title', 'type' => 'heading', 'props' => ['text' => 'One']]]));
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();

        $this->asVisitor();
        $first = $this->getJson('http://berry.test/api/v1/store/builder/pages/home')->assertOk()
            ->assertHeader('Cache-Control', 'max-age=60, public, stale-while-revalidate=300');
        $etag = $first->headers->get('ETag');
        $this->getJson('http://berry.test/api/v1/store/builder/pages/home', ['If-None-Match' => $etag])->assertStatus(304);

        // Publishing busts the cached page.
        $this->actingAsUser($admin);
        $this->saveDraft($home, $this->page([['id' => 'e_title', 'type' => 'heading', 'props' => ['text' => 'Two']]]));
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();
        $this->asVisitor();
        $second = $this->getJson('http://berry.test/api/v1/store/builder/pages/home', ['If-None-Match' => $etag])->assertOk()
            ->assertJsonPath('data.sections.0.columns.0.elements.0.props.text', 'Two');
        $this->assertNotSame($etag, $second->headers->get('ETag'));

        // The HTML shell serves published landing pages at /p/{slug}.
        $shell = tempnam(sys_get_temp_dir(), 'shell');
        file_put_contents($shell, '<!doctype html><html><head><title>Storefront</title></head><body><div id="root"></div></body></html>');
        config(['storefront.shell_path' => $shell]);
        $this->actingAsUser($admin);
        $landing = $this->createPage('landing:eid-sale', 'Eid sale');
        $this->saveDraft($landing, $this->page([['id' => 'e_title', 'type' => 'heading', 'props' => ['text' => 'Eid']]]));
        $this->get('http://berry.test/p/eid-sale?preview=draft')->assertOk()->assertHeader('X-Robots-Tag', 'noindex');
        $this->asVisitor();
        $this->get('http://berry.test/p/eid-sale')->assertNotFound();
        $this->actingAsUser($admin);
        $this->postJson(self::DOCS."/{$landing}/publish")->assertOk();
        $this->asVisitor();
        $html = $this->get('http://berry.test/p/eid-sale')->assertOk()->getContent();
        $this->assertStringContainsString('<title>Eid sale | Berry Kids</title>', (string) $html);
        @unlink($shell);
    }
}
