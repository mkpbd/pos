<?php

namespace App\Modules\Media\Infrastructure;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\Media\Infrastructure\Models\Media;
use Illuminate\Support\Facades\Storage;
use Throwable;

class EloquentMediaLibrary implements MediaLibrary
{
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
}
