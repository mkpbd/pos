<?php

namespace App\Modules\Media\Tests\Feature;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\Media\Domain\RenditionPlan;
use App\Modules\Media\Infrastructure\Imaging\GdImageProcessor;
use App\Modules\Media\Infrastructure\Models\Media;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Storefront\Tests\Concerns\PublishesTheme;
use App\Modules\Users\Domain\Roles\SystemRole;
use GdImage;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * B11 picture tools: focal point, server-side edits (copy / replace with usage check), upload
 * scaling with EXIF orientation, the full-size WebP rendition and `media:optimize`.
 */
class MediaEditorTest extends TestCase
{
    use InteractsWithTenancy, PublishesTheme, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
    }

    public function test_focal_point_is_saved_cleared_validated_and_exposed_in_every_payload(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $id = $this->upload($this->png($this->halves(400, 200)), 'hero.png', 'Hero');

        $this->getJson('/api/v1/media')->assertOk()->assertJsonPath('data.0.focal', null)->assertJsonPath('data.0.edited_from_id', null);

        $this->patchJson("/api/v1/media/{$id}", ['focal_x' => 20, 'focal_y' => 75])
            ->assertOk()->assertJsonPath('data.focal', ['x' => 20, 'y' => 75])->assertJsonPath('data.alt', 'Hero');
        $this->assertDatabaseHas('audit_logs', ['action' => 'media.updated', 'subject_id' => $id]);
        $this->assertSame(['x' => 20, 'y' => 75], app(MediaLibrary::class)->refs([$id])[$id]['focal']);

        // Alt alone leaves the focal point; both null clears it.
        $this->patchJson("/api/v1/media/{$id}", ['alt' => null])->assertOk()->assertJsonPath('data.focal', ['x' => 20, 'y' => 75])->assertJsonPath('data.alt', null);
        $this->patchJson("/api/v1/media/{$id}", ['focal_x' => null, 'focal_y' => null])->assertOk()->assertJsonPath('data.focal', null);
        $this->assertNull(app(MediaLibrary::class)->refs([$id])[$id]['focal']);

        $this->patchJson("/api/v1/media/{$id}", ['focal_x' => 101, 'focal_y' => 5])->assertStatus(422);
        $this->patchJson("/api/v1/media/{$id}", ['focal_x' => 50])->assertStatus(422);
        $this->patchJson("/api/v1/media/{$id}", [])->assertStatus(422);
    }

    public function test_edit_as_copy_crops_turns_and_flips_in_the_documented_order(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->actingAsUser($admin);
        // Left half red, right half blue.
        $id = $this->upload($this->png($this->halves(400, 200)), 'Shirt.png', 'Blue shirt');
        $this->patchJson("/api/v1/media/{$id}", ['focal_x' => 10, 'focal_y' => 10])->assertOk();

        // Turned a quarter clockwise: the left side ends on top.
        $copy = $this->postJson("/api/v1/media/{$id}/edit", ['rotate' => 90])
            ->assertCreated()
            ->assertJsonPath('data.width', 200)
            ->assertJsonPath('data.height', 400)
            ->assertJsonPath('data.edited_from_id', $id)
            ->assertJsonPath('data.alt', 'Blue shirt')
            ->assertJsonPath('data.original_name', 'Shirt (edited).png')
            // The shape changed and no focal point was given: back to the centre.
            ->assertJsonPath('data.focal', null)
            ->json('data');
        $image = $this->stored($copy['id']);
        $this->assertColor([255, 0, 0], $image, 100, 50);
        $this->assertColor([0, 0, 255], $image, 100, 350);
        $this->assertDatabaseHas('audit_logs', ['action' => 'media.edited', 'subject_id' => $copy['id']]);

        // Crop (source pixels) the right 300 px, then mirror: the blue part moves to the left.
        $cropped = $this->postJson("/api/v1/media/{$id}/edit", ['crop' => ['x' => 100, 'y' => 0, 'w' => 300, 'h' => 200], 'flip_h' => true, 'focal_x' => 30, 'focal_y' => 40])
            ->assertCreated()->assertJsonPath('data.width', 300)->assertJsonPath('data.height', 200)->assertJsonPath('data.focal', ['x' => 30, 'y' => 40])
            ->json('data');
        $image = $this->stored($cropped['id']);
        $this->assertColor([0, 0, 255], $image, 20, 100);
        $this->assertColor([255, 0, 0], $image, 280, 100);

        // The original is untouched; the same edit again returns the existing copy.
        $this->assertSame(400, Media::query()->findOrFail($id)->width);
        Storage::disk('public')->assertExists("media/{$org->id}/{$id}.png");
        $this->postJson("/api/v1/media/{$id}/edit", ['rotate' => 90])->assertOk()->assertJsonPath('data.id', $copy['id']);
        $this->assertDatabaseCount('media', 3);
    }

    public function test_light_and_colour_adjustments_match_the_css_preview(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $grey = $this->upload($this->png($this->solid(60, 40, [100, 100, 100])), 'grey.png');
        $this->assertColor([150, 150, 150], $this->stored($this->postJson("/api/v1/media/{$grey}/edit", ['brightness' => 50])->assertCreated()->json('data.id')), 5, 5, 3);
        $this->assertColor([50, 50, 50], $this->stored($this->postJson("/api/v1/media/{$grey}/edit", ['brightness' => -50])->assertCreated()->json('data.id')), 5, 5, 3);

        $light = $this->upload($this->png($this->solid(60, 40, [200, 200, 200])), 'light.png');
        // (200 − 127.5) × 1.5 + 127.5
        $this->assertColor([236, 236, 236], $this->stored($this->postJson("/api/v1/media/{$light}/edit", ['contrast' => 50])->assertCreated()->json('data.id')), 5, 5, 3);

        // Saturation, JPEG path (blend with a grey copy) and PNG path (pixel by pixel), within rounding.
        $jpeg = $this->upload($this->jpeg($this->solid(64, 64, [200, 100, 100]), 100), 'rose.jpg');
        $this->assertColor([235, 85, 85], $this->stored($this->postJson("/api/v1/media/{$jpeg}/edit", ['saturation' => 50])->assertCreated()->json('data.id')), 32, 32, 10);
        $this->assertColor([165, 115, 115], $this->stored($this->postJson("/api/v1/media/{$jpeg}/edit", ['saturation' => -50])->assertCreated()->json('data.id')), 32, 32, 10);
        $png = $this->upload($this->png($this->solid(30, 30, [200, 100, 100])), 'rose.png');
        $this->assertColor([239, 89, 89], $this->stored($this->postJson("/api/v1/media/{$png}/edit", ['saturation' => 50])->assertCreated()->json('data.id')), 5, 5, 2);

        // Transparency survives an adjustment.
        $logo = imagecreatetruecolor(20, 20);
        imagealphablending($logo, false);
        imagesavealpha($logo, true);
        imagefill($logo, 0, 0, (int) imagecolorallocatealpha($logo, 0, 0, 0, 127));
        imagefilledrectangle($logo, 5, 5, 14, 14, (int) imagecolorallocatealpha($logo, 100, 100, 100, 0));
        $logoId = $this->upload($this->png($logo), 'logo.png');
        $edited = $this->stored($this->postJson("/api/v1/media/{$logoId}/edit", ['brightness' => 20, 'saturation' => -30])->assertCreated()->json('data.id'));
        $this->assertSame(127, (imagecolorat($edited, 0, 0) >> 24) & 0x7F);
        $this->assertSame(0, (imagecolorat($edited, 10, 10) >> 24) & 0x7F);

        // Editing never puts the console process (tests, queue worker, media:optimize) on a clock.
        $this->assertSame(0, (int) ini_get('max_execution_time'));
        $this->assertFalse(app(GdImageProcessor::class)->allowTime(120));
    }

    public function test_replace_keeps_the_id_and_asks_before_changing_a_picture_in_use(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $id = $this->upload($this->png($this->halves(400, 200)), 'banner.png');

        $this->getJson("/api/v1/media/{$id}/usage")->assertOk()->assertJsonPath('data', ['in_use' => false, 'places' => []]);
        $this->postJson("/api/v1/media/{$id}/edit", ['crop' => ['x' => 0, 'y' => 0, 'w' => 200, 'h' => 200], 'mode' => 'replace'])
            ->assertOk()->assertJsonPath('data.id', $id)->assertJsonPath('data.width', 200)->assertJsonPath('data.edited_from_id', null);
        $media = Media::query()->findOrFail($id);
        $this->assertNotSame("media/{$org->id}/{$id}.png", $media->path);
        Storage::disk('public')->assertMissing("media/{$org->id}/{$id}.png");
        Storage::disk('public')->assertExists($media->path);
        $this->assertColor([255, 0, 0], $this->stored($id), 150, 100);
        $this->assertDatabaseCount('media', 1);

        // In use by the theme and a menu: refused with the places, done when confirmed.
        $this->publishTheme(['logo_media_id' => $id])->assertOk();
        $menu = $this->postJson('/api/v1/storefront/menus', ['name' => 'Main', 'location' => 'main'])->json('data.id');
        $this->putJson("/api/v1/storefront/menus/{$menu}/items", ['items' => [
            ['label' => 'Baby', 'url' => '/baby', 'is_mega' => true, 'image_media_id' => $id],
        ]])->assertOk();
        $places = $this->getJson("/api/v1/media/{$id}/usage")->assertOk()->assertJsonPath('data.in_use', true)->json('data.places');
        $this->assertContains('Store theme (logo or icons)', $places);
        $this->assertContains('Menus', $places);

        $this->postJson("/api/v1/media/{$id}/edit", ['rotate' => 180, 'mode' => 'replace'])
            ->assertStatus(422)->assertJsonPath('error.code', 'IN_USE')->assertJsonPath('error.details.places', $places);
        $this->postJson("/api/v1/media/{$id}/edit", ['rotate' => 180, 'mode' => 'replace', 'confirm_replace' => true])->assertOk();
        // A copy is always allowed.
        $this->postJson("/api/v1/media/{$id}/edit", ['brightness' => -20])->assertCreated();
    }

    public function test_edit_rules_and_tenant_isolation(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        ['admin' => $otherAdmin] = $this->provisionTenant('Other Shop');
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);

        $this->actingAsUser($otherAdmin);
        $foreign = $this->upload($this->png($this->halves(100, 50)), 'x.png');

        $this->actingAsUser($admin);
        $id = $this->upload($this->png($this->halves(100, 50)), 'y.png');
        $this->postJson("/api/v1/media/{$id}/edit", [])->assertStatus(422)->assertJsonPath('error.code', 'NO_CHANGES');
        $this->postJson("/api/v1/media/{$id}/edit", ['crop' => ['x' => 0, 'y' => 0, 'w' => 100, 'h' => 50]])->assertStatus(422)->assertJsonPath('error.code', 'NO_CHANGES');
        $this->postJson("/api/v1/media/{$id}/edit", ['crop' => ['x' => 50, 'y' => 0, 'w' => 60, 'h' => 50]])->assertStatus(422)->assertJsonPath('error.code', 'INVALID_CROP');
        $this->postJson("/api/v1/media/{$id}/edit", ['rotate' => 45])->assertStatus(422);
        $this->postJson("/api/v1/media/{$id}/edit", ['brightness' => 51])->assertStatus(422);
        $this->postJson("/api/v1/media/{$id}/edit", ['rotate' => 90, 'mode' => 'move'])->assertStatus(422);

        $gif = $this->upload((string) $this->encodeWith('imagegif', $this->halves(40, 40)), 'a.gif');
        $this->postJson("/api/v1/media/{$gif}/edit", ['rotate' => 90])->assertStatus(422)->assertJsonPath('error.code', 'UNSUPPORTED_IMAGE');

        $this->postJson("/api/v1/media/{$foreign}/edit", ['rotate' => 90])->assertNotFound();
        $this->getJson("/api/v1/media/{$foreign}/usage")->assertNotFound();
        $this->patchJson("/api/v1/media/{$foreign}", ['focal_x' => 1, 'focal_y' => 1])->assertNotFound();
        $this->assertNull(Media::query()->withoutGlobalScopes()->findOrFail($foreign)->focal_x);

        $this->actingAsUser($cashier);
        $this->postJson("/api/v1/media/{$id}/edit", ['rotate' => 90])->assertForbidden();
        $this->getJson("/api/v1/media/{$id}/usage")->assertForbidden();
    }

    public function test_oversized_uploads_are_scaled_down_and_jpegs_turned_upright_without_metadata(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $big = $this->post('/api/v1/media', ['file' => UploadedFile::fake()->image('wide.png', 3000, 1500)], $this->spaHeaders())
            ->assertCreated()->assertJsonPath('data.width', RenditionPlan::MAX_SIDE)->assertJsonPath('data.height', 1280)->json('data');
        $this->assertSame([RenditionPlan::MAX_SIDE, 1280], array_slice((array) getimagesizefromstring((string) Storage::disk('public')->get(Media::query()->findOrFail($big['id'])->path)), 0, 2));
        $this->assertDatabaseHas('audit_logs', ['action' => 'media.uploaded', 'subject_id' => $big['id']]);

        // A camera JPEG stored sideways with EXIF orientation 6 ("turn 90° clockwise").
        $jpeg = $this->withOrientation($this->jpeg($this->halves(400, 200), 90), 6);
        $this->assertSame(6, $this->exifOrientation($jpeg));
        $upright = $this->post('/api/v1/media', ['file' => UploadedFile::fake()->createWithContent('camera.jpg', $jpeg)], $this->spaHeaders())
            ->assertCreated()->assertJsonPath('data.width', 200)->assertJsonPath('data.height', 400)->json('data');
        $stored = (string) Storage::disk('public')->get(Media::query()->findOrFail($upright['id'])->path);
        $this->assertNull($this->exifOrientation($stored));
        $this->assertColor([255, 0, 0], $this->stored($upright['id']), 100, 50, 30);
        $this->assertColor([0, 0, 255], $this->stored($upright['id']), 100, 350, 30);

        // Within the limit and upright: stored byte for byte.
        $small = $this->png($this->halves(300, 200));
        $id = $this->upload($small, 'small.png');
        $this->assertSame($small, Storage::disk('public')->get(Media::query()->findOrFail($id)->path));
    }

    public function test_large_jpegs_get_a_full_size_webp_rendition_and_the_url_stays_the_original(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $noise = imagecreatetruecolor(800, 600);
        mt_srand(11);
        for ($y = 0; $y < 600; $y++) {
            for ($x = 0; $x < 800; $x++) {
                imagesetpixel($noise, $x, $y, mt_rand(0, 0xFFFFFF));
            }
        }
        $bytes = $this->jpeg($noise, 100);
        $this->assertGreaterThan(RenditionPlan::FULL_SIZE_WEBP_MIN_BYTES, strlen($bytes));

        $media = $this->post('/api/v1/media', ['file' => UploadedFile::fake()->createWithContent('noise.jpg', $bytes)], $this->spaHeaders())->assertCreated()->json('data');
        $this->assertStringEndsWith('.jpg', $media['url']);
        $row = Media::query()->findOrFail($media['id']);
        $this->assertArrayHasKey('800', $row->renditions);
        $this->assertStringEndsWith('-800.webp 800w', $row->srcset());
        $this->assertStringNotContainsString('.jpg 800w', $row->srcset());

        // Small files keep the original in their srcset.
        $small = $this->upload($this->png($this->halves(700, 100)), 'strip.png');
        $this->assertStringEndsWith('.png 700w', Media::query()->findOrFail($small)->srcset());
    }

    public function test_media_optimize_scales_down_old_oversized_originals(): void
    {
        ['organization' => $org] = $this->provisionTenant();
        $path = "media/{$org->id}/old.png";
        Storage::disk('public')->put($path, $this->png($this->halves(3000, 1000)));
        $media = new Media([
            'organization_id' => $org->id, 'disk' => 'public', 'path' => $path, 'original_name' => 'old.png', 'mime_type' => 'image/png',
            'size' => Storage::disk('public')->size($path), 'width' => 3000, 'height' => 1000, 'alt' => 'Old', 'checksum' => str_repeat('a', 64),
            'focal_x' => 40, 'focal_y' => 60,
        ]);
        $media->save();

        $this->artisan('media:optimize', ['--dry-run' => true])->expectsOutputToContain('Would resize')->assertSuccessful();
        $this->assertSame(3000, $media->refresh()->width);
        Storage::disk('public')->assertExists($path);

        $this->artisan('media:optimize')->expectsOutputToContain('1 original(s) were scaled down')->assertSuccessful();
        $media->refresh();
        $this->assertSame([2560, 853], [$media->width, $media->height]);
        $this->assertSame(['x' => 40, 'y' => 60], $media->focal());
        Storage::disk('public')->assertMissing($path);
        Storage::disk('public')->assertExists($media->path);
        $this->assertArrayHasKey('1280', $media->renditions);

        $this->artisan('media:optimize')->expectsOutputToContain('0 original(s) were scaled down')->assertSuccessful();
    }

    // ------------------------------------------------------------------------------------------

    private function upload(string $bytes, string $name, ?string $alt = null): string
    {
        return (string) $this->post('/api/v1/media', array_filter(['file' => UploadedFile::fake()->createWithContent($name, $bytes), 'alt' => $alt]), $this->spaHeaders())
            ->assertCreated()->json('data.id');
    }

    private function stored(string $id): GdImage
    {
        $media = Media::query()->withoutGlobalScopes()->findOrFail($id);
        $image = imagecreatefromstring((string) Storage::disk('public')->get($media->path));
        $this->assertInstanceOf(GdImage::class, $image);

        return $image;
    }

    /** Left half red, right half blue. */
    private function halves(int $w, int $h): GdImage
    {
        $image = imagecreatetruecolor($w, $h);
        imagefilledrectangle($image, 0, 0, intdiv($w, 2) - 1, $h - 1, (int) imagecolorallocate($image, 255, 0, 0));
        imagefilledrectangle($image, intdiv($w, 2), 0, $w - 1, $h - 1, (int) imagecolorallocate($image, 0, 0, 255));

        return $image;
    }

    /**
     * @param  array{0: int, 1: int, 2: int}  $rgb
     */
    private function solid(int $w, int $h, array $rgb): GdImage
    {
        $image = imagecreatetruecolor($w, $h);
        imagefill($image, 0, 0, (int) imagecolorallocate($image, ...$rgb));

        return $image;
    }

    private function png(GdImage $image): string
    {
        imagesavealpha($image, true);

        return $this->encodeWith('imagepng', $image);
    }

    private function jpeg(GdImage $image, int $quality): string
    {
        ob_start();
        imagejpeg($image, null, $quality);

        return (string) ob_get_clean();
    }

    private function encodeWith(string $function, GdImage $image): string
    {
        ob_start();
        $function($image);

        return (string) ob_get_clean();
    }

    /** Inserts a minimal EXIF block (APP1) with only the orientation tag after the JPEG's SOI marker. */
    private function withOrientation(string $jpeg, int $orientation): string
    {
        $tiff = 'II'.pack('v', 42).pack('V', 8).pack('v', 1)
            .pack('v', 0x0112).pack('v', 3).pack('V', 1).pack('v', $orientation).pack('v', 0)
            .pack('V', 0);
        $payload = "Exif\0\0".$tiff;

        return substr($jpeg, 0, 2)."\xFF\xE1".pack('n', strlen($payload) + 2).$payload.substr($jpeg, 2);
    }

    private function exifOrientation(string $jpeg): ?int
    {
        $exif = @exif_read_data('data://image/jpeg;base64,'.base64_encode($jpeg));

        return is_array($exif) && isset($exif['Orientation']) ? (int) $exif['Orientation'] : null;
    }

    /**
     * @param  array{0: int, 1: int, 2: int}  $expected
     */
    private function assertColor(array $expected, GdImage $image, int $x, int $y, int $tolerance = 0): void
    {
        $c = imagecolorat($image, $x, $y);
        $actual = [($c >> 16) & 0xFF, ($c >> 8) & 0xFF, $c & 0xFF];
        foreach ($expected as $i => $value) {
            $this->assertEqualsWithDelta($value, $actual[$i], $tolerance, "Colour at {$x},{$y}: got [".implode(', ', $actual).'], expected ['.implode(', ', $expected).']');
        }
    }
}
