<?php

namespace App\Modules\Media\Tests\Feature;

use App\Modules\Media\Infrastructure\Imaging\GdImageProcessor;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * B22a: AVIF uploads — stored as uploaded with WebP renditions where GD reads AVIF, refused
 * with a clear 422 otherwise (never a 500).
 */
class MediaAvifTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    /** A 40 × 30 red AVIF (316 bytes, written by GD's imageavif). */
    private const AVIF_40X30 = 'AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAA'
        .'AGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAACIAAAAoaWluZgAAAAAAAQAAABppbmZl'
        .'AgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAACgAAAAeAAAAEHBpeGkAAAAAAwgICAAAAAxh'
        .'djFDgQAMAAAAABNjb2xybmNseAABAA0AAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACptZGF0EgAKCRgVJ+sEBDQGEDITGwAa'
        .'aaaFAMcFGmOCa/CQBRnxow==';

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
    }

    private function fixture(): UploadedFile
    {
        $path = (string) tempnam(sys_get_temp_dir(), 'avif');
        file_put_contents($path, base64_decode(self::AVIF_40X30));

        return new UploadedFile($path, 'banner.avif', 'image/avif', null, true);
    }

    public function test_an_avif_picture_is_stored_as_uploaded_with_webp_renditions(): void
    {
        if (! app(GdImageProcessor::class)->readsAvif()) {
            $this->markTestSkipped('This PHP build’s GD does not read AVIF.');
        }
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $response = $this->post('/api/v1/media', ['file' => $this->fixture(), 'alt' => 'Red'], $this->spaHeaders())
            ->assertCreated()
            ->assertJsonPath('data.width', 40)
            ->assertJsonPath('data.height', 30);

        $id = $response->json('data.id');
        Storage::disk('public')->assertExists("media/{$org->id}/{$id}.avif");
        $this->assertDatabaseHas('media', ['id' => $id, 'mime_type' => 'image/avif']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'media.uploaded', 'subject_id' => $id]);
    }

    public function test_avif_renditions_are_webp(): void
    {
        if (! app(GdImageProcessor::class)->readsAvif() || ! function_exists('imageavif')) {
            $this->markTestSkipped('This PHP build’s GD does not read / write AVIF.');
        }
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->actingAsUser($admin);
        // Wide enough for the 320 and 640 renditions.
        $image = imagecreatetruecolor(700, 400);
        imagefill($image, 0, 0, (int) imagecolorallocate($image, 20, 120, 200));
        $path = (string) tempnam(sys_get_temp_dir(), 'avif');
        imageavif($image, $path, 40, 10);

        $id = $this->post('/api/v1/media', ['file' => new UploadedFile($path, 'wide.avif', 'image/avif', null, true)], $this->spaHeaders())
            ->assertCreated()->json('data.id');

        foreach ([320, 640] as $width) {
            Storage::disk('public')->assertExists("media/{$org->id}/{$id}-{$width}.webp");
        }
        $this->assertSame(3, preg_match_all('/ (320|640|700)w/', (string) $this->getJson('/api/v1/media')->json('data.0.srcset')));
    }

    public function test_avif_is_refused_with_a_clear_message_when_the_server_cannot_read_it(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);
        config(['media.avif' => false]);

        $this->post('/api/v1/media', ['file' => $this->fixture()], $this->spaHeaders())
            ->assertUnprocessable()
            ->assertJsonPath('error.code', 'UNSUPPORTED_IMAGE')
            ->assertJsonPath('error.message', 'AVIF pictures need AVIF support on the server — upload JPEG, PNG or WebP.');
        $this->assertDatabaseCount('media', 0);
        $this->assertSame([], Storage::disk('public')->allFiles());
    }
}
