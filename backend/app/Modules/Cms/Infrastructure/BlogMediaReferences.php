<?php

namespace App\Modules\Cms\Infrastructure;

use App\Modules\Cms\Infrastructure\Models\BlogPost;
use App\Modules\Media\Application\Contracts\MediaReferences;

/**
 * A blog post's cover image cannot be deleted from the media library while the post exists
 * (deleted posts let go of it). Images inside the body are not tracked, like pages.
 */
class BlogMediaReferences implements MediaReferences
{
    public function uses(string $mediaId): bool
    {
        return BlogPost::query()->where('cover_media_id', $mediaId)->exists();
    }
}
