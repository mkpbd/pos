<?php

namespace App\Modules\Media\Tests\Feature;

use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class MediaLibraryTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
    }

    public function test_upload_stores_the_image_with_webp_renditions_and_dedupes_identical_files(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $file = UploadedFile::fake()->image('Hero Banner.png', 1600, 900);

        $response = $this->post('/api/v1/media', ['file' => $file, 'alt' => 'Spring sale'], $this->spaHeaders())
            ->assertCreated()
            ->assertJsonPath('data.width', 1600)
            ->assertJsonPath('data.height', 900)
            ->assertJsonPath('data.alt', 'Spring sale')
            ->assertJsonPath('data.original_name', 'Hero Banner.png');

        $id = $response->json('data.id');
        $this->assertStringStartsWith("/storage/media/{$org->id}/", $response->json('data.url'));
        Storage::disk('public')->assertExists("media/{$org->id}/{$id}.png");

        // Queue is synchronous in tests: renditions exist right away (320, 640, 1280 < 1600).
        $listed = $this->getJson('/api/v1/media')->assertOk()->json('data.0');
        $this->assertSame(4, preg_match_all('/ (320|640|1280|1600)w/', $listed['srcset']));
        foreach ([320, 640, 1280] as $width) {
            Storage::disk('public')->assertExists("media/{$org->id}/{$id}-{$width}.webp");
        }
        $this->assertDatabaseHas('audit_logs', ['action' => 'media.uploaded', 'subject_id' => $id]);

        // Same bytes again: the existing item, not a second copy.
        $this->post('/api/v1/media', ['file' => $file], $this->spaHeaders())->assertOk()->assertJsonPath('data.id', $id);
        $this->assertDatabaseCount('media', 1);
    }

    public function test_small_images_get_no_renditions_and_only_raster_images_are_accepted(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $small = $this->post('/api/v1/media', ['file' => UploadedFile::fake()->image('logo.png', 300, 100)], $this->spaHeaders())->assertCreated();
        $this->assertSame($small->json('data.url').' 300w', $small->json('data.srcset'));

        $svg = UploadedFile::fake()->createWithContent('logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
        $this->post('/api/v1/media', ['file' => $svg], $this->spaHeaders())->assertStatus(422);
        $this->post('/api/v1/media', ['file' => UploadedFile::fake()->create('doc.pdf', 10, 'application/pdf')], $this->spaHeaders())->assertStatus(422);
    }

    public function test_alt_text_update_and_delete_of_unused_media(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $id = $this->post('/api/v1/media', ['file' => UploadedFile::fake()->image('a.jpg', 800, 600)], $this->spaHeaders())->json('data.id');

        $this->patchJson("/api/v1/media/{$id}", ['alt' => 'Baby romper'])->assertOk()->assertJsonPath('data.alt', 'Baby romper');
        $this->assertDatabaseHas('audit_logs', ['action' => 'media.updated', 'subject_id' => $id]);

        $this->deleteJson("/api/v1/media/{$id}")->assertNoContent();
        Storage::disk('public')->assertMissing("media/{$org->id}/{$id}.jpg");
        Storage::disk('public')->assertMissing("media/{$org->id}/{$id}-640.webp");
        $this->assertDatabaseMissing('media', ['id' => $id]);
    }

    public function test_media_used_by_the_theme_or_a_menu_cannot_be_deleted(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $logo = $this->post('/api/v1/media', ['file' => UploadedFile::fake()->image('logo.png', 400, 120)], $this->spaHeaders())->json('data.id');
        $promo = $this->post('/api/v1/media', ['file' => UploadedFile::fake()->image('promo.png', 600, 600)], $this->spaHeaders())->json('data.id');

        $this->putJson('/api/v1/storefront/theme', ['logo_media_id' => $logo])->assertOk();
        $this->deleteJson("/api/v1/media/{$logo}")->assertStatus(422)->assertJsonPath('error.code', 'IN_USE');

        $menu = $this->postJson('/api/v1/storefront/menus', ['name' => 'Main', 'location' => 'main'])->json('data.id');
        $this->putJson("/api/v1/storefront/menus/{$menu}/items", ['items' => [
            ['label' => 'Baby', 'url' => '/baby', 'is_mega' => true, 'image_media_id' => $promo],
        ]])->assertOk();
        $this->deleteJson("/api/v1/media/{$promo}")->assertStatus(422)->assertJsonPath('error.code', 'IN_USE');
    }

    public function test_media_needs_permission_and_is_tenant_isolated(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        ['admin' => $otherAdmin] = $this->provisionTenant('Other Shop');
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);

        $this->actingAsUser($otherAdmin);
        $foreign = $this->post('/api/v1/media', ['file' => UploadedFile::fake()->image('x.png', 50, 50)], $this->spaHeaders())->json('data.id');

        $this->actingAsUser($admin);
        $this->getJson('/api/v1/media')->assertOk()->assertJsonCount(0, 'data');
        // Lookup by id never reaches another organization's media.
        $mine = $this->post('/api/v1/media', ['file' => UploadedFile::fake()->image('y.png', 60, 60)], $this->spaHeaders())->json('data.id');
        $this->getJson("/api/v1/media?ids={$mine},{$foreign}")->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $mine);
        $this->getJson('/api/v1/media?ids=not-a-uuid')->assertStatus(422);
        $this->patchJson("/api/v1/media/{$foreign}", ['alt' => 'mine'])->assertNotFound();
        $this->deleteJson("/api/v1/media/{$foreign}")->assertNotFound();

        $this->actingAsUser($cashier);
        $this->getJson('/api/v1/media')->assertForbidden();
    }
}
