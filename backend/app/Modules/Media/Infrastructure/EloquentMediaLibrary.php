<?php

namespace App\Modules\Media\Infrastructure;

use App\Modules\Media\Application\Actions\UploadMedia;
use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\Media\Infrastructure\Models\Media;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Throwable;

class EloquentMediaLibrary implements MediaLibrary
{
    /** B5: the upload limits of `POST /media` (MediaController::store) for imported files. */
    private const IMPORT_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

    private const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

    private const IMPORT_MAX_SIDE = 6000;

    public function existing(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        return Media::query()->whereIn('id', array_values(array_unique($ids)))->pluck('id')->all();
    }

    public function refs(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        return Media::query()->whereIn('id', array_values(array_unique($ids)))->get()
            ->mapWithKeys(fn (Media $m) => [$m->id => [
                'id' => $m->id,
                'url' => $m->url(),
                'srcset' => $m->srcset(),
                'width' => $m->width,
                'height' => $m->height,
                'alt' => $m->alt,
            ]])
            ->all();
    }

    public function dataUri(string $id, int $minWidth = 240, int $maxBytes = 524288): ?string
    {
        $media = Media::query()->find($id);
        if ($media === null) {
            return null;
        }
        $path = $media->path;
        $mime = $media->mime_type;
        $widths = array_map('intval', array_keys($media->renditions));
        sort($widths);
        foreach ($widths as $width) {
            if ($width >= $minWidth && $width < $media->width) {
                $path = $media->renditions[(string) $width] ?? $media->renditions[$width] ?? $path;
                $mime = 'image/webp';
                break;
            }
        }
        try {
            $disk = Storage::disk($media->disk);
            if (! $disk->exists($path) || $disk->size($path) > $maxBytes) {
                return null;
            }
            $contents = $disk->get($path);
        } catch (Throwable) {
            return null;
        }
        if (! is_string($contents) || ! str_starts_with($mime, 'image/')) {
            return null;
        }

        return 'data:'.$mime.';base64,'.base64_encode($contents);
    }

    public function import(string $path, string $name, ?string $alt): array
    {
        $size = is_file($path) ? filesize($path) : false;
        $dimensions = $size === false ? false : @getimagesize($path);
        if ($size === false || $size > self::IMPORT_MAX_BYTES || $dimensions === false
            || ! in_array($dimensions['mime'] ?? null, self::IMPORT_MIMES, true)
            || $dimensions[0] > self::IMPORT_MAX_SIDE || $dimensions[1] > self::IMPORT_MAX_SIDE) {
            throw new BusinessRuleViolation('INVALID_IMAGE', 'The file is not a supported image (JPEG, PNG, WebP or GIF up to 5 MB and 6000 × 6000 px).', ['name' => $name]);
        }

        // Stored with storeAs(), which copies the file: the original stays in place.
        ['media' => $media, 'created' => $created] = app(UploadMedia::class)(
            new UploadedFile($path, $name, $dimensions['mime'], null, true),
            $alt === null ? null : mb_substr($alt, 0, 200),
        );

        return ['id' => $media->id, 'created' => $created];
    }
}
