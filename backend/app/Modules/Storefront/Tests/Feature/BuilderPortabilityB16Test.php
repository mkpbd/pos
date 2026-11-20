<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\Media\Infrastructure\Models\Media;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Storefront\Infrastructure\Models\Banner;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * B16: builder pages as files — the export (references instead of ids, pictures embedded with
 * their checksum, globals inlined, nothing of another store), the import into another store
 * (pictures through the media library with dedupe, products by SKU / address, categories and
 * brands by address, banners recreated, what is missing dropped and reported, never published),
 * replacing a draft (revision, kind, edit lock), bad files, permissions and isolation.
 */
class BuilderPortabilityB16Test extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

    private const IMPORT = '/api/v1/storefront/builder/import';

    /** @var array<string, mixed> */
    private array $a;

    /** @var array<string, string> */
    private array $ids = [];

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        Storage::fake((string) config('media.disk'));
        $this->a = $this->openStore('Berry Kids', 'berry.test');
    }

    private function image(string $name, int $width, int $height): string
    {
        return $this->post('/api/v1/media', ['file' => UploadedFile::fake()->image($name, $width, $height)], $this->spaHeaders())->assertSuccessful()->json('data.id');
    }

    /**
     * Store A's landing page `eid` using a global, a photo, products, a category, a brand, a banner and custom HTML.
     */
    private function sourcePage(): string
    {
        $org = $this->a['organization'];
        $tea = $this->makeProduct($this->a['unit']->id, 'Tea', [['TEA-1', '120.00']]);
        $this->publish($tea['id'], ['slug' => 'green-tea']);
        $mug = $this->makeProduct($this->a['unit']->id, 'Mug', [['MUG-1', '90.00']]);
        $this->publish($mug['id'], ['slug' => 'mug']);
        $drinks = $this->category($org, 'Drinks');
        $this->listCategory($drinks, ['slug' => 'drinks']);
        $pran = $this->brand($org, 'Pran');
        $this->listBrand($pran, ['slug' => 'pran']);
        $photo = $this->image('photo.jpg', 1200, 800);
        $banner = $this->postJson('/api/v1/storefront/banners', [
            'placement' => 'hero_slider', 'name' => 'Eid hero', 'title' => 'Eid offers',
            'desktop_media_id' => $this->image('hero.jpg', 1600, 600), 'translations' => ['bn' => ['title' => 'ঈদ অফার']],
        ])->assertCreated()->json('data.id');
        $global = $this->postJson(self::DOCS, ['kind' => 'global', 'title' => 'Promo strip', 'context' => 'page', 'from' => 'section', 'section' => [
            'id' => 's_promo', 'type' => 'section', 'columns' => [['id' => 'c_promo', 'width' => ['base' => 100], 'elements' => [
                ['id' => 'e_promo', 'type' => 'heading', 'props' => ['text' => 'Free delivery', 'level' => 2]],
            ]]],
        ]])->assertCreated()->json('data.id');
        $this->ids += ['tea' => $tea['id'], 'mug' => $mug['id'], 'drinks' => $drinks, 'pran' => $pran, 'photo' => $photo, 'banner' => $banner, 'global' => $global];

        $page = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:eid', 'title' => 'Eid sale'])->assertCreated()->json('data.id');
        $this->putJson(self::DOCS."/{$page}/draft", ['revision' => 0, 'content' => ['schema_version' => 1, 'sections' => [
            ['id' => 'g_promo', 'type' => 'global_section', 'ref' => $global],
            ['id' => 's_main', 'type' => 'section', 'columns' => [['id' => 'c_main', 'width' => ['base' => 100], 'elements' => [
                ['id' => 'e_photo', 'type' => 'image', 'props' => ['media_id' => $photo, 'alt' => 'Eid table']],
                ['id' => 'e_spot', 'type' => 'product_spotlight', 'props' => ['product_id' => $tea['id']]],
                ['id' => 'e_grid', 'type' => 'product_grid', 'props' => ['config' => ['source' => 'manual', 'limit' => 8], 'items' => [
                    ['item_type' => 'product', 'item_id' => $tea['id']], ['item_type' => 'product', 'item_id' => $mug['id']],
                ]]],
                ['id' => 'e_cat', 'type' => 'category_card', 'props' => ['category_id' => $drinks]],
                ['id' => 'e_brands', 'type' => 'brand_strip', 'props' => ['config' => ['source' => 'manual', 'limit' => 12], 'items' => [['item_type' => 'brand', 'item_id' => $pran]]]],
                ['id' => 'e_slider', 'type' => 'hero_slider', 'props' => ['items' => [['item_type' => 'banner', 'item_id' => $banner]]]],
                ['id' => 'e_html', 'type' => 'custom_html', 'props' => ['html' => '<p>Hand made</p>']],
            ]]]],
        ]]])->assertOk();

        return $page;
    }

    /**
     * @return array<string, mixed>
     */
    private function export(string $page): array
    {
        return $this->get(self::DOCS."/{$page}/export")->assertOk()->json();
    }

    /**
     * @param  array<string, mixed>  $file
     * @param  array<string, mixed>  $fields
     */
    private function import(array $file, array $fields): TestResponse
    {
        return $this->post(self::IMPORT, $fields + ['file' => UploadedFile::fake()->createWithContent('page.json', (string) json_encode($file))], $this->spaHeaders());
    }

    /**
     * @param  list<string>  $permissions
     */
    private function staff(array $organizationTenant, array $permissions): User
    {
        $organization = $organizationTenant['organization'];

        return $this->createUserWithRole($organization, $this->inTenant($organization, function () use ($permissions) {
            $role = Role::query()->create(['name' => 'Staff '.Str::random(4)]);
            $role->permissions()->sync($permissions);

            return $role;
        }));
    }

    /**
     * @param  array<string, mixed>  $content
     * @return list<array<string, mixed>>
     */
    private static function elements(array $content): array
    {
        $elements = [];
        foreach ($content['sections'] as $section) {
            foreach ($section['columns'] ?? [] as $column) {
                array_push($elements, ...$column['elements']);
            }
        }

        return $elements;
    }

    public function test_export_replaces_ids_with_references_embeds_pictures_and_inlines_globals(): void
    {
        $page = $this->sourcePage();
        $response = $this->get(self::DOCS."/{$page}/export")->assertOk()->assertHeader('Content-Disposition', 'attachment; filename="eid.json"');
        $file = $response->json();
        $raw = (string) $response->getContent();

        $this->assertSame(['pos-builder-page', 1, 'Berry Kids'], [$file['format'], $file['version'], $file['source']['store']]);
        $this->assertSame(['page', 'landing', 'Eid sale', 'page'], [$file['document']['kind'], $file['document']['key_kind'], $file['document']['title'], $file['document']['context']]);
        foreach (['tea', 'mug', 'drinks', 'pran', 'photo', 'banner', 'global'] as $key) {
            $this->assertStringNotContainsString($this->ids[$key], $raw, "{$key} id leaked");
        }
        // The global's section is a plain section now.
        $this->assertSame(['section', 'section'], array_column($file['document']['content']['sections'], 'type'));
        $this->assertSame('Free delivery', $file['document']['content']['sections'][0]['columns'][0]['elements'][0]['props']['text']);
        $elements = array_column(self::elements($file['document']['content']), null, 'id');
        $this->assertSame('@ref:media:1', $elements['e_photo']['props']['media_id']);
        $this->assertSame('@ref:product:1', $elements['e_spot']['props']['product_id']);
        $this->assertSame(['@ref:product:1', '@ref:product:2'], array_column($elements['e_grid']['props']['items'], 'item_id'));
        $this->assertSame('@ref:banner:1', $elements['e_slider']['props']['items'][0]['item_id']);

        $this->assertCount(2, $file['media']);
        $this->assertSame(['@ref:media:1', '@ref:media:2'], array_column($file['media'], 'ref'));
        foreach ($file['media'] as $media) {
            $this->assertSame($media['sha256'], hash('sha256', base64_decode($media['data'])));
        }
        $this->assertSame([
            ['ref' => '@ref:product:1', 'sku' => 'TEA-1', 'slug' => 'green-tea', 'name' => 'Tea'],
            ['ref' => '@ref:product:2', 'sku' => 'MUG-1', 'slug' => 'mug', 'name' => 'Mug'],
        ], $file['references']['products']);
        $this->assertSame([['ref' => '@ref:category:1', 'slug' => 'drinks', 'name' => 'Drinks']], $file['references']['categories']);
        $this->assertSame([['ref' => '@ref:brand:1', 'slug' => 'pran', 'name' => 'Pran']], $file['references']['brands']);
        $this->assertSame(['@ref:banner:1', 'hero_slider', 'Eid hero', 'Eid offers', '@ref:media:2'], [
            $file['references']['banners'][0]['ref'], $file['references']['banners'][0]['placement'], $file['references']['banners'][0]['name'],
            $file['references']['banners'][0]['title'], $file['references']['banners'][0]['image'],
        ]);
        $this->assertSame(1, DB::table('audit_logs')->where('action', 'storefront.builder_exported')->count());
    }

    public function test_import_into_another_store_maps_what_exists_and_reports_the_rest(): void
    {
        $file = $this->export($this->sourcePage());

        $b = $this->openStore('Other Shop', 'other.test');
        $tea = $this->makeProduct($b['unit']->id, 'Green tea B', [['tea-1', '150.00']]);
        $drinks = $this->category($b['organization'], 'Drinks');
        $this->listCategory($drinks, ['slug' => 'drinks']);
        // Without the custom HTML permission, custom HTML is left out.
        $this->actingAsUser($this->staff($b, ['storefront.view', 'storefront.manage']));

        $report = $this->import($file, ['target' => 'new', 'title' => 'Eid copy', 'key' => 'landing:eid-copy'])->assertCreated()->json('data');
        $this->assertSame(['media' => 2, 'products' => 1, 'categories' => 1, 'brands' => 0, 'banners' => 1, 'menus' => 0, 'blog_categories' => 0, 'promotions' => 0], $report['mapped']);
        $this->assertEqualsCanonicalizing([['type' => 'product', 'name' => 'Mug'], ['type' => 'brand', 'name' => 'Pran']], $report['missing']);
        $this->assertEqualsCanonicalizing([['type' => 'brand_strip', 'count' => 1], ['type' => 'custom_html', 'count' => 1]], $report['dropped_elements']);
        $this->assertSame(['landing:eid-copy', 'Eid copy', null, '/p/eid-copy'], [
            $report['created_document']['key'], $report['created_document']['title'], $report['created_document']['published'], $report['created_document']['path'],
        ]);

        $document = $this->inTenant($b['organization'], fn () => BuilderDocument::query()->findOrFail($report['created_document']['id']));
        $this->assertNull($document->published_version_id);
        $elements = array_column(self::elements($document->draft), null, 'id');
        $this->assertSame(['e_promo', 'e_photo', 'e_spot', 'e_grid', 'e_cat', 'e_slider'], array_keys($elements));
        $this->assertSame($tea['id'], $elements['e_spot']['props']['product_id']);
        $this->assertSame([$tea['id']], array_column($elements['e_grid']['props']['items'], 'item_id'));
        $this->assertSame($drinks, $elements['e_cat']['props']['category_id']);
        $media = $this->inTenant($b['organization'], fn () => Media::query()->pluck('id')->all());
        $this->assertContains($elements['e_photo']['props']['media_id'], $media);
        $banner = $this->inTenant($b['organization'], fn () => Banner::query()->findOrFail($elements['e_slider']['props']['items'][0]['item_id']));
        $this->assertSame(['Eid hero', 'Eid offers', ['bn' => ['title' => 'ঈদ অফার']]], [$banner->name, $banner->title, $banner->translations]);
        $this->assertSame(1, DB::table('audit_logs')->where('action', 'storefront.builder_imported')->where('organization_id', $b['organization']->id)->count());

        // Replacing the draft again reuses the pictures and the banner (nothing duplicated).
        $this->import($file, ['target' => 'replace', 'document_id' => $document->id, 'revision' => 0])->assertOk()
            ->assertJsonPath('data.created_document.id', $document->id)->assertJsonPath('data.created_document.draft_revision', 1);
        $this->assertSame(2, $this->inTenant($b['organization'], fn () => Media::query()->count()));
        $this->assertSame(1, $this->inTenant($b['organization'], fn () => Banner::query()->count()));
        // The source store is unchanged.
        $this->assertSame(1, $this->inTenant($this->a['organization'], fn () => BuilderDocument::query()->where('key', 'like', 'landing:%')->count()));
    }

    public function test_import_checks_the_file_and_the_target(): void
    {
        $file = $this->export($this->sourcePage());
        $page = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:spring', 'title' => 'Spring'])->assertCreated()->json('data.id');

        $this->post(self::IMPORT, ['target' => 'new', 'title' => 'X', 'key' => 'landing:xy', 'file' => UploadedFile::fake()->createWithContent('page.json', 'not json')], $this->spaHeaders())
            ->assertStatus(422)->assertJsonPath('error.code', 'IMPORT_INVALID')->assertJsonPath('error.details.reason', 'not_json');
        $this->import(['format' => 'something-else'] + $file, ['target' => 'new', 'title' => 'X', 'key' => 'landing:xy'])->assertStatus(422)->assertJsonPath('error.details.reason', 'format');
        $this->import(['version' => 2] + $file, ['target' => 'new', 'title' => 'X', 'key' => 'landing:xy'])->assertStatus(422)->assertJsonPath('error.details.reason', 'version');
        $broken = $file;
        unset($broken['document']['content']);
        $this->import($broken, ['target' => 'new', 'title' => 'X', 'key' => 'landing:xy'])->assertStatus(422)->assertJsonPath('error.details.reason', 'structure');
        $this->post(self::IMPORT, ['target' => 'new', 'title' => 'X', 'key' => 'landing:xy', 'file' => UploadedFile::fake()->create('page.json', 31 * 1024)], $this->spaHeaders())
            ->assertStatus(422)->assertJsonPath('error.code', 'IMPORT_TOO_LARGE');
        $this->import($file, ['target' => 'new', 'title' => 'X', 'key' => 'landing:spring'])->assertStatus(409)->assertJsonPath('error.code', 'DOCUMENT_EXISTS');
        $this->import($file, ['target' => 'new', 'title' => 'X', 'key' => 'landing:home'])->assertStatus(422)->assertJsonValidationErrors('key', 'error.details');
        $this->import($file, ['target' => 'replace', 'document_id' => $page, 'revision' => 5])->assertStatus(409)->assertJsonPath('error.code', 'DRAFT_CONFLICT');
        $header = $this->postJson(self::DOCS, ['kind' => 'header', 'key' => 'header', 'title' => 'Header'])->assertCreated()->json('data.id');
        $this->import($file, ['target' => 'replace', 'document_id' => $header, 'revision' => 0])->assertStatus(422)->assertJsonPath('error.code', 'IMPORT_KIND_MISMATCH');

        // Someone else is editing the page: 423.
        $editor = $this->staff($this->a, ['storefront.view', 'storefront.manage']);
        $this->actingAsUser($editor);
        $this->postJson(self::DOCS."/{$page}/presence", ['editing' => true])->assertOk()->assertJsonPath('data.mine', true);
        $this->actingAsUser($this->a['admin']);
        $this->import($file, ['target' => 'replace', 'document_id' => $page, 'revision' => 0])->assertStatus(423)->assertJsonPath('error.code', 'DOCUMENT_LOCKED');
        $this->postJson(self::DOCS."/{$page}/address", ['slug' => 'summer'])->assertStatus(423);
        $this->assertSame(0, $this->inTenant($this->a['organization'], fn () => BuilderDocument::query()->findOrFail($page)->draft_revision));
    }

    public function test_export_and_import_need_storefront_manage_and_stay_in_the_store(): void
    {
        $page = $this->sourcePage();
        $file = $this->export($page);

        $this->actingAsUser($this->staff($this->a, ['storefront.view']));
        $this->get(self::DOCS."/{$page}/export")->assertForbidden();
        $this->import($file, ['target' => 'new', 'title' => 'X', 'key' => 'landing:xy'])->assertForbidden();

        $this->openStore('Other Shop', 'other.test');
        $this->get(self::DOCS."/{$page}/export")->assertNotFound();
        $this->import($file, ['target' => 'replace', 'document_id' => $page, 'revision' => 1])->assertNotFound();
        $this->postJson(self::DOCS."/{$page}/address", ['slug' => 'mine'])->assertNotFound();
    }
}
