<?php

namespace App\Modules\Media\Presentation\Http\Resources;

use App\Modules\Media\Infrastructure\Models\Media;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @property Media $resource
 */
class MediaResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $m = $this->resource;

        return [
            'id' => $m->id,
            'url' => $m->url(),
            'srcset' => $m->srcset(),
            'width' => $m->width,
            'height' => $m->height,
            'alt' => $m->alt,
            'original_name' => $m->original_name,
            'mime_type' => $m->mime_type,
            'size' => $m->size,
            'created_at' => $m->created_at?->toIso8601String(),
        ];
    }
}
