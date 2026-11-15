<?php

namespace App\Modules\Media\Infrastructure\Jobs;

use App\Modules\Media\Domain\RenditionPlan;
use App\Modules\Media\Infrastructure\Models\Media;
use App\Modules\Shared\Application\Contracts\StorefrontContentVersion;
use GdImage;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * Writes WebP copies at the standard widths narrower than the original (GD; no image
 * package needed). GIFs are left alone so animations survive. A failure only means the
 * original is served without a srcset, so it is logged and not retried.
 *
 * B11: JPEG and PNG originals over RenditionPlan::FULL_SIZE_WEBP_MIN_BYTES also get a WebP
 * copy at their own width, kept only when it is smaller than the original.
 */
class GenerateMediaRenditions implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public function __construct(public readonly string $mediaId) {}

    public function handle(): void
    {
        // Runs outside a request: no tenant in context, so the lookup is by id only.
        $media = Media::query()->find($this->mediaId);
        if ($media === null || $media->mime_type === 'image/gif' || ! function_exists('imagewebp')) {
            return;
        }

        $widths = RenditionPlan::widthsFor($media->width);
        $fullSize = RenditionPlan::wantsFullSizeWebp($media->mime_type, $media->size);
        if ($widths === [] && ! $fullSize) {
            return;
        }

        $disk = Storage::disk($media->disk);
        $source = @imagecreatefromstring((string) $disk->get($media->path));
        if (! $source instanceof GdImage) {
            Log::warning('Media renditions skipped: unreadable image', ['media_id' => $media->id]);

            return;
        }
        if (! imageistruecolor($source)) {
            imagepalettetotruecolor($source);
        }

        $renditions = [];
        $base = preg_replace('/\.[^.\/]+$/', '', $media->path);
        foreach ($widths as $width) {
            $scaled = imagescale($source, $width, RenditionPlan::heightFor($width, $media->width, $media->height), IMG_BICUBIC);
            if ($scaled === false) {
                continue;
            }
            imagesavealpha($scaled, true);
            ob_start();
            imagewebp($scaled, null, 80);
            $path = "{$base}-{$width}.webp";
            $disk->put($path, (string) ob_get_clean());
            $renditions[(string) $width] = $path;
        }

        if ($fullSize) {
            imagesavealpha($source, true);
            ob_start();
            imagewebp($source, null, 80);
            $bytes = (string) ob_get_clean();
            if ($bytes !== '' && strlen($bytes) < $media->size) {
                $path = "{$base}-{$media->width}.webp";
                $disk->put($path, $bytes);
                $renditions[(string) $media->width] = $path;
            }
        }

        $media->renditions = $renditions;
        $media->saveQuietly();
        // B11: an edited picture keeps its id; cached storefront pages pick up the new srcset.
        if ($media->wasChanged('renditions')) {
            app(StorefrontContentVersion::class)->bump($media->organization_id);
        }
    }
}
