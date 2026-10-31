<?php

namespace App\Modules\Media\Infrastructure\Jobs;

use App\Modules\Media\Domain\RenditionPlan;
use App\Modules\Media\Infrastructure\Models\Media;
use GdImage;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * Writes WebP copies at the standard widths narrower than the original (GD; no image
 * package needed). GIFs are left alone so animations survive. A failure only means the
 * original is served without a srcset, so it is logged and not retried.
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
        if ($widths === []) {
            return;
        }

        $disk = Storage::disk($media->disk);
        $source = @imagecreatefromstring((string) $disk->get($media->path));
        if (! $source instanceof GdImage) {
            Log::warning('Media renditions skipped: unreadable image', ['media_id' => $media->id]);

            return;
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

        $media->renditions = $renditions;
        $media->saveQuietly();
    }
}
