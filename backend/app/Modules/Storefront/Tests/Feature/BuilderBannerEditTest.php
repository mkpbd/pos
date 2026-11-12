<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Storefront\Application\Builder\EditBuilderBanner;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Editing a banner from the store builder (POST /storefront/builder/documents/{document}/banners/{banner}):
 * in place when only this document's draft shows it, a copy (copy-on-write) when a homepage
 * section, another document or any published version uses it; validation, permissions and
 * tenant isolation.
 */
class BuilderBannerEditTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        Date::setTestNow('2026-11-12T10:00:00+06:00');
    }

    /**
     * @return array{organization: Organization, admin: User}
     */
    private function store(string $name): array
    {
        $tenant = $this->provisionTenant($name);
        $this->actingAsUser($tenant['admin']);

        return $tenant;
    }

    private function image(string $name = 'photo.jpg'): string
    {
        return $this->post('/api/v1/media', ['file' => UploadedFile::fake()->image($name, 1600, 600)], $this->spaHeaders())->assertSuccessful()->json('data.id');
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function banner(string $name, array $overrides = []): string
    {
        return $this->postJson('/api/v1/storefront/banners', $overrides + [
            'placement' => 'hero_slider',
            'name' => $name,
            'title' => "{$name} title",
            'desktop_media_id' => $this->image(),
            'translations' => ['bn' => ['title' => 'বাংলা']],
        ])->assertCreated()->json('data.id');
    }

    /**
     * A page whose draft has one hero slider showing the banners.
     */
    private function page(string $key, string $title, string ...$bannerIds): string
    {
        $id = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => $key, 'title' => $title])->assertCreated()->json('data.id');
        $this->putJson(self::DOCS."/{$id}/draft", ['revision' => 0, 'content' => ['schema_version' => 1, 'sections' => [[
            'id' => 's_main', 'type' => 'section',
            'columns' => [['id' => 'c_main', 'width' => ['base' => 100], 'elements' => [
                ['id' => 'e_slider', 'type' => 'hero_slider', 'props' => ['items' => array_map(fn (string $b) => ['item_type' => 'banner', 'item_id' => $b], $bannerIds)]],
            ]]],
        ]]]])->assertOk();

        return $id;
    }

    private function edit(string $document, string $banner, array $input): TestResponse
    {
        return $this->postJson(self::DOCS."/{$document}/banners/{$banner}", $input);
    }

    public function test_a_banner_only_this_draft_shows_is_updated_in_place(): void
    {
        $this->store('Berry Kids');
        $men = $this->banner('Men');
        $other = $this->banner('Other');
        $page = $this->page('landing:test-page', 'Test page', $men);
        // Another document's draft showing a different banner does not matter.
        $this->page('landing:other', 'Other page', $other);
        $image = $this->image('new.jpg');

        $this->edit($page, $men, [
            'title' => 'New title',
            'kicker' => 'Fresh',
            'desktop_media_id' => $image,
            'translations' => ['bn' => ['subtitle' => 'নতুন']],
        ])->assertOk()
            ->assertJsonPath('data.replaced', null)
            ->assertJsonPath('data.banner.id', $men)
            ->assertJsonPath('data.banner.name', 'Men')
            ->assertJsonPath('data.banner.title', 'New title')
            ->assertJsonPath('data.banner.kicker', 'Fresh')
            ->assertJsonPath('data.banner.desktop_media_id', $image)
            ->assertJsonPath('data.banner.translations.bn.title', 'বাংলা')
            ->assertJsonPath('data.banner.translations.bn.subtitle', 'নতুন');

        $this->getJson('/api/v1/storefront/banners')->assertOk()->assertJsonCount(2, 'data');
        $this->assertDatabaseHas('audit_logs', ['action' => 'banner.updated']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_banner_edited']);

        // The draft render shows the new title at once.
        $this->getJson(self::DOCS."/{$page}/render")->assertOk()->assertJsonPath('data.data.e_slider.banners.0.title', 'New title');
    }

    public function test_a_banner_the_homepage_shows_is_copied(): void
    {
        $this->store('Berry Kids');
        $men = $this->banner('Men', ['link_url' => '/men', 'button_label' => 'Shop']);
        $this->postJson('/api/v1/storefront/homepage-sections', ['type' => 'hero_slider', 'banner_ids' => [$men]])->assertCreated();
        $page = $this->page('landing:test-page', 'Test page', $men);

        $response = $this->edit($page, $men, ['title' => 'Only on this page'])->assertOk();
        $copy = $response->json('data.banner.id');
        $this->assertNotSame($men, $copy);
        $response->assertJsonPath('data.replaced', ['old_id' => $men, 'new_id' => $copy])
            ->assertJsonPath('data.banner.name', 'Men · Test page')
            ->assertJsonPath('data.banner.placement', 'hero_slider')
            ->assertJsonPath('data.banner.title', 'Only on this page')
            // The rest comes from the original.
            ->assertJsonPath('data.banner.link_url', '/men')
            ->assertJsonPath('data.banner.button_label', 'Shop')
            ->assertJsonPath('data.banner.translations.bn.title', 'বাংলা');

        // The original (and so the homepage) is unchanged.
        $this->getJson("/api/v1/storefront/banners/{$men}")->assertOk()->assertJsonPath('data.title', 'Men title')->assertJsonPath('data.name', 'Men');
        $this->assertDatabaseHas('audit_logs', ['action' => 'banner.created']);

        // Editing the copy again (only this draft once the editor swapped it) is in place.
        $content = json_decode(str_replace($men, $copy, (string) json_encode($this->getJson(self::DOCS."/{$page}")->json('data.content'))), true);
        $this->putJson(self::DOCS."/{$page}/draft", ['revision' => 1, 'content' => $content])->assertOk();
        $this->edit($page, $copy, ['title' => 'Again', 'name' => 'Men · Test page'])->assertOk()
            ->assertJsonPath('data.replaced', null)->assertJsonPath('data.banner.id', $copy);
    }

    public function test_a_banner_another_document_shows_is_copied(): void
    {
        $this->store('Berry Kids');
        $men = $this->banner('Men');
        $page = $this->page('landing:test-page', 'Test page', $men);
        $this->page('landing:other', 'Other page', $men);

        $response = $this->edit($page, $men, ['name' => 'Men banner', 'title' => 'Changed'])->assertOk()
            ->assertJsonPath('data.replaced.old_id', $men)
            ->assertJsonPath('data.banner.name', 'Men banner · Test page');
        $this->assertNotSame($men, $response->json('data.replaced.new_id'));
        $this->getJson("/api/v1/storefront/banners/{$men}")->assertJsonPath('data.title', 'Men title');
    }

    public function test_a_banner_of_the_own_published_version_is_copied(): void
    {
        $this->store('Berry Kids');
        $men = $this->banner('Men');
        $page = $this->page('landing:test-page', 'Test page', $men);
        $this->postJson(self::DOCS."/{$page}/publish")->assertOk();

        $copy = $this->edit($page, $men, ['title' => 'Draft only'])->assertOk()
            ->assertJsonPath('data.replaced.old_id', $men)->json('data.replaced.new_id');
        $this->assertIsString($copy);
        // The live page keeps the original.
        $this->getJson(self::DOCS."/{$page}/render?source=published")->assertOk()->assertJsonPath('data.data.e_slider.banners.0.title', 'Men title');
    }

    public function test_copy_names_stay_within_the_limit(): void
    {
        $this->assertSame('Men · Test page', EditBuilderBanner::copyName('Men', 'Test page'));
        $this->assertSame('Men · Test page', EditBuilderBanner::copyName('Men · Test page', 'Test page'));
        $this->assertSame('Men', EditBuilderBanner::copyName('Men', ''));
        $long = EditBuilderBanner::copyName(str_repeat('a', 80), str_repeat('b', 160));
        $this->assertSame(80, mb_strlen($long));
        $this->assertStringEndsWith('…', $long);
        $this->assertStringStartsWith('aaaa', $long);
    }

    public function test_validation_and_popups(): void
    {
        $this->store('Berry Kids');
        $men = $this->banner('Men');
        $page = $this->page('landing:test-page', 'Test page', $men);

        $this->edit($page, $men, ['title' => str_repeat('x', 121), 'link_url' => 'javascript:alert(1)', 'text_color' => 'red', 'desktop_media_id' => 'nope'])
            ->assertUnprocessable()->assertJsonValidationErrors(['title', 'link_url', 'text_color', 'desktop_media_id'], 'error.details');
        $this->edit($page, $men, ['button_label' => 'Shop', 'link_url' => null])->assertUnprocessable()->assertJsonPath('error.code', 'BUTTON_LINK_REQUIRED');
        $this->edit($page, $men, ['desktop_media_id' => '01900000-0000-7000-8000-0000000000aa'])->assertUnprocessable()->assertJsonPath('error.code', 'MEDIA_NOT_FOUND');
        // The placement never changes here.
        $this->edit($page, $men, ['placement' => 'home_promo'])->assertOk()->assertJsonPath('data.banner.placement', 'hero_slider');

        $popup = $this->banner('Popup', ['placement' => 'popup']);
        $this->edit($page, $popup, ['title' => 'x'])->assertUnprocessable()->assertJsonPath('error.code', 'BANNER_NOT_EDITABLE_HERE');
        $this->getJson("/api/v1/storefront/banners/{$men}")->assertJsonPath('data.title', 'Men title');
    }

    public function test_permissions_and_tenant_isolation(): void
    {
        ['organization' => $berry, 'admin' => $berryAdmin] = $this->store('Berry Kids');
        $men = $this->banner('Men');
        $page = $this->page('landing:test-page', 'Test page', $men);

        $roleId = $this->postJson('/api/v1/roles', ['name' => 'Store viewer', 'permissions' => ['storefront.view']])->assertCreated()->json('data.id');
        $viewer = $this->createUserWithRole($berry, $this->inTenant($berry, fn () => Role::query()->findOrFail($roleId)));
        $this->actingAsUser($viewer);
        $this->edit($page, $men, ['title' => 'x'])->assertForbidden();
        $this->actingAsUser($this->createUserWithRole($berry, SystemRole::Cashier));
        $this->edit($page, $men, ['title' => 'x'])->assertForbidden();
        $this->app['auth']->forgetGuards();
        $this->edit($page, $men, ['title' => 'x'])->assertUnauthorized();

        // Another organization: neither Berry's document nor Berry's banner exists for it.
        $this->store('Tiny Toes');
        $tinyBanner = $this->banner('Tiny');
        $tinyPage = $this->page('landing:tiny', 'Tiny page', $tinyBanner);
        $this->edit($page, $men, ['title' => 'x'])->assertNotFound();
        $this->edit($tinyPage, $men, ['title' => 'x'])->assertNotFound();
        $this->edit($page, $tinyBanner, ['title' => 'x'])->assertNotFound();
        // Tiny's own edit is in place: another organization's documents never count as uses.
        $berryOther = $this->inTenant($berry, fn () => BuilderDocument::query()->create(['kind' => 'page', 'key' => 'landing:stray', 'title' => 'Stray', 'draft' => ['mentions' => ['item_id' => $tinyBanner]]])->id);
        $this->assertDatabaseHas('builder_documents', ['id' => $berryOther, 'organization_id' => $berry->id]);
        $this->edit($tinyPage, $tinyBanner, ['title' => 'Tiny new'])->assertOk()->assertJsonPath('data.replaced', null);

        $this->actingAsUser($berryAdmin);
        $this->getJson("/api/v1/storefront/banners/{$men}")->assertJsonPath('data.title', 'Men title');
    }
}
