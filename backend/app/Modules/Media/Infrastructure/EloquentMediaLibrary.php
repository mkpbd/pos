<?php

namespace App\Modules\Media\Infrastructure;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\Media\Infrastructure\Models\Media;

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
}
