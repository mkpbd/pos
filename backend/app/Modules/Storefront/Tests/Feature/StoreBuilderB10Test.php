<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Storefront\Infrastructure\Models\StorefrontFont;
use App\Modules\Users\Application\Contracts\UserDirectory;
use App\Modules\Users\Infrastructure\Models\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Mockery;
use Tests\TestCase;

/**
 * B10: the server page check before publishing, Bangla typography keys and the store's own
 * fonts (upload rules, usage, delete, theme payload, shell preload) — permissions and isolation.
 * PostgreSQL.
 */
class StoreBuilderB10Test extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

    private const FONTS = '/api/v1/storefront/fonts';

    private const DRAFT = '/api/v1/storefront/theme/draft';

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
        config(['storefront.shell_path' => $this->shell]);
        $this->t = $this->openStore('Berry Kids', 'berry.test');
    }

    protected function tearDown(): void
    {
        @unlink($this->shell);
        parent::tearDown();
    }

    /**
     * A minimal valid WOFF2 header (48 bytes) plus padding; `$seed` makes the bytes unique.
     */
    private static function woff2(string $seed = 'a', int $padding = 64): string
    {
        $body = str_repeat($seed, $padding);
        $length = 48 + strlen($body);

        return 'wOF2'."\x00\x01\x00\x00".pack('N', $length).pack('n', 3).pack('n', 0).str_repeat("\x00", 32).$body;
    }

    /**
     * @param  array<string, mixed>  $fields
     */
    private function upload(string $name, string $bytes, array $fields = []): TestResponse
    {
        return $this->post(self::FONTS, $fields + ['name' => $name, 'file' => UploadedFile::fake()->createWithContent(strtolower($name).'.woff2', $bytes)], $this->spaHeaders() + ['Accept' => 'application/json']);
    }

    /**
     * @param  list<array<string, mixed>>  $elements
     * @return array<string, mixed>
     */
    private function section(string $id, array $elements, array $extra = []): array
    {
        return $extra + ['id' => $id, 'type' => 'section', 'columns' => [['id' => 'c'.$id, 'width' => ['base' => 100], 'elements' => $elements]]];
    }

    private function button(string $id, string $url): array
    {
        return ['id' => $id, 'type' => 'button', 'props' => ['label' => 'Go', 'link' => ['url' => $url]]];
    }

    private function save(string $id, array $content): TestResponse
    {
        $revision = $this->getJson(self::DOCS."/{$id}")->assertOk()->json('data.draft_revision');

        return $this->putJson(self::DOCS."/{$id}/draft", ['revision' => $revision, 'content' => ['schema_version' => 1] + $content]);
    }

    /**
     * @param  array<string, mixed>  $settings
     */
    private function saveTheme(array $settings): TestResponse
    {
        $revision = $this->getJson(self::DRAFT)->assertOk()->json('data.draft_revision');

        return $this->putJson(self::DRAFT, ['revision' => $revision, 'settings' => $settings]);
    }

    /**
     * @param  list<array<string, mixed>>  $issues
     * @return array<string, list<array<string, mixed>>> code => issues
     */
    private static function byCode(array $issues): array
    {
        $codes = [];
        foreach ($issues as $issue) {
            $codes[$issue['code']][] = $issue;
        }

        return $codes;
    }

    public function test_page_check_reports_what_the_live_page_would_lose(): void
    {
        $organization = $this->t['organization'];
        $tea = $this->makeProduct($this->t['unit']->id, 'Green Tea', [['TEA', '350.00']]);
        $mug = $this->makeProduct($this->t['unit']->id, 'Mug', [['MUG', '200.00']]);
        $this->publish($tea['id']);
        $teaSlug = $this->inTenant($organization, fn () => app(StorefrontCatalog::class)->productSummaries([$tea['id']])[$tea['id']]['slug']);
        $shown = $this->category($organization, 'Drinks');
        $this->listCategory($shown);
        $hidden = $this->category($organization, 'Secret');
        $drinksUrl = $this->inTenant($organization, fn () => collect(app(StorefrontCatalog::class)->linkTargets()['categories'])->firstWhere('id', $shown)['url']);
        $this->postJson('/api/v1/cms/pages', ['slug' => 'about', 'title' => 'About us', 'status' => 'published', 'body_html' => '<p>Hi</p>'])->assertCreated();
        $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:eid', 'title' => 'Eid'])->assertCreated();
        $global = $this->postJson(self::DOCS, ['kind' => 'global', 'title' => 'Promo strip', 'context' => 'page'])->assertCreated()->json('data.id');

        $home = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home'])->assertCreated()->json('data.id');
        $this->save($home, ['sections' => [
            ['id' => 'g_promo', 'type' => 'global_section', 'ref' => $global],
            $this->section('s_main', [
                ['id' => 'e_tea', 'type' => 'promo_card', 'props' => ['product_id' => $tea['id']]],
                ['id' => 'e_mug', 'type' => 'promo_card', 'props' => ['product_id' => $mug['id']]],
                ['id' => 'e_order', 'type' => 'order_form', 'props' => ['product_id' => $mug['id'], 'upsell' => ['product_id' => $tea['id'], 'label' => 'Add tea']]],
                ['id' => 'e_cat', 'type' => 'category_card', 'props' => ['category_id' => $hidden]],
                $this->button('e_ok1', '/shop?sort=new'),
                $this->button('e_ok2', '/product/'.$teaSlug),
                $this->button('e_ok3', $drinksUrl),
                $this->button('e_ok4', '/pages/about'),
                $this->button('e_ok5', 'https://example.com/product/nope'),
                $this->button('e_bad1', '/product/no-such-tea'),
                $this->button('e_bad2', '/category/secret'),
                $this->button('e_bad3', '/pages/missing'),
                $this->button('e_bad4', '/p/eid'),
                $this->button('e_bad5', 'https://BERRY.test/blog/nothing-here'),
                $this->button('e_odd', '/sale'),
                ['id' => 'e_form', 'type' => 'form', 'props' => ['title' => 'Ask us', 'fields' => [['id' => 'f_q', 'kind' => 'text', 'label' => 'Question', 'required' => true]]]],
            ]),
            // Hidden: links and liveness are not checked there.
            $this->section('s_hidden', [$this->button('e_hidden', '/product/ghost')], ['hidden' => true]),
        ]])->assertOk();

        $result = $this->postJson(self::DOCS."/{$home}/check")->assertOk()->json('data');
        $codes = self::byCode($result['issues']);

        $this->assertSame(['GLOBAL_UNPUBLISHED', 'ORDER_FORM_PRODUCT_NOT_ON_SALE', 'LINK_BROKEN', 'PRODUCT_NOT_LIVE', 'CATEGORY_HIDDEN', 'LINK_UNKNOWN'], array_keys($codes));
        $this->assertSame(['error' => 7, 'warning' => 3, 'tip' => 0], $result['counts']);
        $this->assertSame(['error', 'error', 'error', 'error', 'error', 'error', 'error', 'warning', 'warning', 'warning'], array_column($result['issues'], 'severity'));
        $this->assertNotNull($result['checked_at']);

        $this->assertSame(['g_promo', ['path' => 'sections.0.ref', 'field' => 'ref', 'global_id' => $global, 'title' => 'Promo strip']], [$codes['GLOBAL_UNPUBLISHED'][0]['node_id'], $codes['GLOBAL_UNPUBLISHED'][0]['details']]);
        $this->assertSame(['e_order', 'props.product_id', [$mug['id']]], [$codes['ORDER_FORM_PRODUCT_NOT_ON_SALE'][0]['node_id'], $codes['ORDER_FORM_PRODUCT_NOT_ON_SALE'][0]['details']['field'], $codes['ORDER_FORM_PRODUCT_NOT_ON_SALE'][0]['details']['ids']]);
        $this->assertSame(['e_mug', 'props.product_id', [$mug['id']]], [$codes['PRODUCT_NOT_LIVE'][0]['node_id'], $codes['PRODUCT_NOT_LIVE'][0]['details']['field'], $codes['PRODUCT_NOT_LIVE'][0]['details']['ids']]);
        $this->assertSame(['e_cat', [$hidden]], [$codes['CATEGORY_HIDDEN'][0]['node_id'], $codes['CATEGORY_HIDDEN'][0]['details']['ids']]);
        $this->assertSame([
            ['e_bad1', 'product', '/product/no-such-tea'],
            ['e_bad2', 'category', '/category/secret'],
            ['e_bad3', 'page', '/pages/missing'],
            ['e_bad4', 'landing', '/p/eid'],
            ['e_bad5', 'blog_post', 'https://BERRY.test/blog/nothing-here'],
        ], array_map(fn (array $i) => [$i['node_id'], $i['details']['target'], $i['details']['url']], $codes['LINK_BROKEN']));
        $this->assertSame('props.link.url', $codes['LINK_BROKEN'][0]['details']['field']);
        $this->assertSame(['e_odd', ['path' => 'sections.1.columns.0.elements.14.props.link.url', 'field' => 'props.link.url', 'url' => '/sale']], [$codes['LINK_UNKNOWN'][0]['node_id'], $codes['LINK_UNKNOWN'][0]['details']]);
        $this->assertNotContains('e_hidden', array_column($result['issues'], 'node_id'));
        $this->assertArrayNotHasKey('FORM_NO_RECIPIENT', $codes, 'The admin sees form submissions.');

        // Publishing the global and the product clears those issues; nothing was saved by checking.
        $revision = $this->getJson(self::DOCS."/{$home}")->json('data.draft_revision');
        $this->postJson(self::DOCS."/{$global}/publish")->assertOk();
        $this->publish($mug['id']);
        $after = self::byCode($this->postJson(self::DOCS."/{$home}/check")->assertOk()->json('data.issues'));
        $this->assertSame(['LINK_BROKEN', 'CATEGORY_HIDDEN', 'LINK_UNKNOWN'], array_keys($after));
        $this->assertSame($revision, $this->getJson(self::DOCS."/{$home}")->json('data.draft_revision'));

        // Nobody would hear about the form: a tip.
        $users = Mockery::mock(UserDirectory::class);
        $users->shouldReceive('withPermission')->andReturn(collect());
        $this->app->instance(UserDirectory::class, $users);
        $tip = self::byCode($this->postJson(self::DOCS."/{$home}/check")->assertOk()->json('data.issues'))['FORM_NO_RECIPIENT'][0];
        $this->assertSame(['tip', 'e_form', 'props.notify_email'], [$tip['severity'], $tip['node_id'], $tip['details']['field']]);
    }

    public function test_page_check_of_unsaved_content_reports_gone_records_and_refuses_malformed_content(): void
    {
        $home = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home'])->assertCreated()->json('data.id');
        $gone = '0195f1e2-0000-7000-8000-000000000001';

        $result = $this->postJson(self::DOCS."/{$home}/check", ['content' => ['schema_version' => 1, 'seo' => ['title' => 'Hi', 'image' => ['media_id' => $gone]], 'sections' => [
            $this->section('s_a', [['id' => 'e_photo', 'type' => 'image', 'props' => ['media_id' => $gone, 'alt' => 'Gone']]]),
        ]]])->assertOk()->json('data');
        $this->assertSame([
            ['MEDIA_NOT_FOUND', 'error', null, 'seo.image.media_id', [$gone]],
            ['MEDIA_NOT_FOUND', 'error', 'e_photo', 'props.media_id', [$gone]],
        ], array_map(fn (array $i) => [$i['code'], $i['severity'], $i['node_id'], $i['details']['field'], $i['details']['ids']], $result['issues']));
        $this->assertSame([], $this->getJson(self::DOCS."/{$home}")->json('data.content.sections'), 'Checking saves nothing.');

        $this->postJson(self::DOCS."/{$home}/check", ['content' => ['sections' => 'nope']])->assertStatus(422)->assertJsonPath('error.code', 'DOCUMENT_INVALID');
        $this->postJson(self::DOCS."/{$home}/check", ['content' => 'nope'])->assertStatus(422);

        // A saved, clean draft has no issues.
        $this->save($home, ['sections' => [$this->section('s_a', [$this->button('e_b', '/')])]])->assertOk();
        $this->postJson(self::DOCS."/{$home}/check")->assertOk()->assertJsonPath('data.issues', [])->assertJsonPath('data.counts', ['error' => 0, 'warning' => 0, 'tip' => 0]);
    }

    public function test_page_check_is_scoped_to_the_organization_and_needs_manage(): void
    {
        $home = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home'])->assertCreated()->json('data.id');

        $other = $this->openStore('Other Shop', 'other.test');
        $this->postJson(self::DOCS."/{$home}/check")->assertNotFound();
        $theirs = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home'])->assertCreated()->json('data.id');
        // Their product id in our unsaved content reads as missing.
        $product = $this->makeProduct($other['unit']->id, 'Their tea', [['THEIRS', '10.00']]);

        $this->actingAsUser($this->t['admin']);
        $this->postJson(self::DOCS."/{$theirs}/check")->assertNotFound();
        $issues = $this->postJson(self::DOCS."/{$home}/check", ['content' => ['sections' => [$this->section('s_a', [['id' => 'e_p', 'type' => 'promo_card', 'props' => ['product_id' => $product['id']]]])]]])
            ->assertOk()->json('data.issues');
        $this->assertSame([['PRODUCT_NOT_FOUND', [$product['id']]]], array_map(fn (array $i) => [$i['code'], $i['details']['ids']], $issues));

        $viewer = $this->createUserWithRole($this->t['organization'], $this->inTenant($this->t['organization'], function () {
            $role = Role::query()->create(['name' => 'Viewer']);
            $role->permissions()->sync(['storefront.view']);

            return $role;
        }));
        $this->actingAsUser($viewer);
        $this->postJson(self::DOCS."/{$home}/check")->assertForbidden();
    }

    public function test_custom_fonts_upload_rules_and_listing(): void
    {
        $this->getJson(self::FONTS)->assertOk()->assertJsonPath('data', ['fonts' => [], 'limit' => 4, 'max_bytes' => 512000]);

        $created = $this->upload('Shonar', self::woff2('a'), ['weight_min' => 300, 'weight_max' => 700])->assertCreated()->json('data');
        $id = $created['id'];
        $organization = $this->t['organization']->id;
        $this->assertSame([
            'id' => $id, 'key' => 'custom:'.$id, 'name' => 'Shonar', 'family' => 'sf-custom-'.substr(str_replace('-', '', $id), 0, 12),
            'url' => "/storage/fonts/{$organization}/{$id}.woff2", 'format' => 'woff2', 'weight_min' => 300, 'weight_max' => 700,
            'size' => strlen(self::woff2('a')), 'used_by' => [], 'roles' => [],
        ], array_diff_key($created, ['created_at' => true]));
        Storage::disk((string) config('media.disk'))->assertExists("fonts/{$organization}/{$id}.woff2");
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.font_uploaded']);

        // Defaults: 400, the heaviest = the lightest.
        $this->assertSame([400, 400], array_values(array_intersect_key($this->upload('Plain', self::woff2('b'))->assertCreated()->json('data'), ['weight_min' => 1, 'weight_max' => 1])));

        $this->upload('Fake', "\x00\x01\x00\x00".str_repeat('x', 200))->assertStatus(422)->assertJsonPath('error.code', 'INVALID_FONT');
        $wrongLength = substr_replace(self::woff2('c'), pack('N', 9999), 8, 4);
        $this->upload('Broken', $wrongLength)->assertStatus(422)->assertJsonPath('error.code', 'INVALID_FONT');
        $this->upload('Huge', self::woff2('d', 520 * 1024))->assertStatus(422)->assertJsonValidationErrors('file', 'error.details');
        $this->upload('Again', self::woff2('a'))->assertStatus(422)->assertJsonPath('error.code', 'FONT_DUPLICATE')->assertJsonPath('error.details.font_id', $id);
        $this->upload('SHONAR', self::woff2('e'))->assertStatus(422)->assertJsonValidationErrors('name', 'error.details');
        $this->upload('Weights', self::woff2('f'), ['weight_min' => 700, 'weight_max' => 400])->assertStatus(422)->assertJsonValidationErrors('weight_max', 'error.details');
        $this->upload('Odd', self::woff2('g'), ['weight_min' => 450])->assertStatus(422)->assertJsonValidationErrors('weight_min', 'error.details');
        $this->upload('', self::woff2('h'))->assertStatus(422)->assertJsonValidationErrors('name', 'error.details');

        $this->upload('Third', self::woff2('i'))->assertCreated();
        $this->upload('Fourth', self::woff2('j'))->assertCreated();
        $this->upload('Fifth', self::woff2('k'))->assertStatus(422)->assertJsonPath('error.code', 'FONT_LIMIT_REACHED')->assertJsonPath('error.details.limit', 4);
        $this->assertSame(['Fourth', 'Plain', 'Shonar', 'Third'], array_column($this->getJson(self::FONTS)->json('data.fonts'), 'name'));
        $this->assertSame(4, StorefrontFont::query()->withoutGlobalScopes()->count());

        // Another store sees none of them and can't delete them; its own limit is separate.
        $this->openStore('Other Shop', 'other.test');
        $this->getJson(self::FONTS)->assertOk()->assertJsonPath('data.fonts', []);
        $this->deleteJson(self::FONTS."/{$id}")->assertNotFound();
        $this->upload('Shonar', self::woff2('a'))->assertCreated();
    }

    public function test_theme_typography_uses_bangla_and_custom_fonts_and_fonts_in_use_cannot_be_deleted(): void
    {
        $font = $this->upload('Shonar', self::woff2('a'), ['weight_min' => 400, 'weight_max' => 700])->assertCreated()->json('data');
        $spare = $this->upload('Spare', self::woff2('b'))->assertCreated()->json('data.id');

        // Today's look: Bangla text in Baloo Da 2 / Hind Siliguri.
        $this->getJson(self::DRAFT)->assertOk()->assertJsonPath('data.fonts', [
            'heading' => 'baloo', 'body' => 'poppins', 'bangla_heading' => 'baloo-da-2', 'bangla_body' => 'hind-siliguri', 'custom' => [],
        ]);

        $this->saveTheme(['typography' => ['heading_font' => 'anek-bangla', 'body_font' => strtoupper($font['key']), 'bangla_body_font' => 'tiro-bangla', 'bangla_line_height' => 1.85, 'bangla_scale' => 1.05]])
            ->assertOk()
            ->assertJsonPath('data.settings.typography.body_font', $font['key'])
            ->assertJsonPath('data.settings.typography.bangla_heading_font', null)
            ->assertJsonPath('data.settings.typography.bangla_line_height', 1.85)
            ->assertJsonPath('data.fonts', [
                'heading' => 'anek-bangla', 'body' => $font['key'], 'bangla_heading' => 'anek-bangla', 'bangla_body' => 'tiro-bangla',
                'custom' => [['id' => $font['key'], 'name' => 'Shonar', 'family' => $font['family'], 'url' => $font['url'], 'format' => 'woff2', 'weight_min' => 400, 'weight_max' => 700]],
            ]);

        // Validation: unknown names, out-of-range spacing, fonts that are not this store's.
        $this->saveTheme(['typography' => ['heading_font' => 'comic-sans', 'bangla_heading_font' => 'poppins', 'bangla_line_height' => 2.5, 'bangla_scale' => 0.5]])
            ->assertStatus(422)->assertJsonValidationErrors(['settings.typography.heading_font', 'settings.typography.bangla_heading_font', 'settings.typography.bangla_line_height', 'settings.typography.bangla_scale'], 'error.details');
        $this->saveTheme(['typography' => ['heading_font' => 'custom:0195f1e2-0000-7000-8000-000000000009']])
            ->assertStatus(422)->assertJsonPath('error.code', 'FONT_NOT_FOUND')->assertJsonPath('error.details.font_ids', ['custom:0195f1e2-0000-7000-8000-000000000009']);

        // In the draft: refused; unused: deleted.
        $this->assertSame(['theme_draft'], $this->getJson(self::FONTS)->json('data.fonts.0.used_by'));
        $this->deleteJson(self::FONTS."/{$font['id']}")->assertStatus(409)->assertJsonPath('error.code', 'FONT_IN_USE')
            ->assertJsonPath('error.details', ['used_by' => ['theme_draft'], 'roles' => ['body']]);
        $this->deleteJson(self::FONTS."/{$spare}")->assertNoContent();
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.font_deleted']);

        // Published: the store loads it (and preloads the body font).
        $this->postJson('/api/v1/storefront/theme/publish')->assertOk();
        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()
            ->assertJsonPath('data.theme.fonts.body', $font['key'])
            ->assertJsonPath('data.theme.fonts.custom.0.url', $font['url'])
            ->assertJsonPath('data.theme.typography.bangla_scale', 1.05);
        $this->assertStringContainsString('<link rel="preload" as="font" type="font/woff2" href="'.$font['url'].'" crossorigin>', $this->get('http://berry.test/')->assertOk()->getContent());

        $this->actingAsUser($this->t['admin']);
        $this->deleteJson(self::FONTS."/{$font['id']}")->assertStatus(409)->assertJsonPath('error.details.used_by', ['live_theme', 'theme_draft']);

        // Another store can't use it.
        $this->openStore('Other Shop', 'other.test');
        $this->saveTheme(['typography' => ['heading_font' => $font['key']]])->assertStatus(422)->assertJsonPath('error.code', 'FONT_NOT_FOUND');
    }

    public function test_restoring_a_theme_version_whose_font_was_deleted_falls_back_to_the_default(): void
    {
        $font = $this->upload('Shonar', self::woff2('a'))->assertCreated()->json('data');
        $this->saveTheme(['typography' => ['heading_font' => $font['key'], 'bangla_heading_font' => $font['key']]])->assertOk();
        $this->postJson('/api/v1/storefront/theme/publish')->assertOk();
        $version = $this->getJson('/api/v1/storefront/theme/versions')->json('data.0.id');

        $this->saveTheme(['typography' => ['heading_font' => 'jost']])->assertOk();
        $this->postJson('/api/v1/storefront/theme/publish')->assertOk();
        $this->deleteJson(self::FONTS."/{$font['id']}")->assertNoContent();
        Storage::disk((string) config('media.disk'))->assertMissing("fonts/{$this->t['organization']->id}/{$font['id']}.woff2");

        $this->postJson("/api/v1/storefront/theme/versions/{$version}/restore")->assertOk()
            ->assertJsonPath('data.settings.typography.heading_font', 'baloo')
            ->assertJsonPath('data.settings.typography.bangla_heading_font', null);
    }

    public function test_presets_reset_the_bangla_typography(): void
    {
        $this->saveTheme(['typography' => ['bangla_body_font' => 'noto-sans-bengali', 'bangla_line_height' => 1.9]])->assertOk();
        $this->postJson('/api/v1/storefront/theme/presets/vegan/apply')->assertOk()
            ->assertJsonPath('data.settings.typography.bangla_body_font', null)
            ->assertJsonPath('data.settings.typography.bangla_line_height', 1.7);
    }
}
