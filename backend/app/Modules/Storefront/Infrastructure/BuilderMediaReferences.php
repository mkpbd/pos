<?php

namespace App\Modules\Storefront\Infrastructure;

use App\Modules\Media\Application\Contracts\MediaReferences;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderVersion;

/**
 * Store builder drafts and versions (B1) keep media ids inside their JSON (image elements,
 * background images, testimonial photos, the newsletter image): media they mention cannot be
 * deleted, so restoring an old version never points at a missing image. A text match — a
 * media id is a uuid, so it only matches where it is referenced.
 */
class BuilderMediaReferences implements MediaReferences
{
    public function uses(string $mediaId): bool
    {
        $pattern = '%'.strtolower($mediaId).'%';

        return BuilderDocument::query()->whereRaw('CAST(draft AS TEXT) LIKE ?', [$pattern])->exists()
            || BuilderVersion::query()->whereRaw('CAST(content AS TEXT) LIKE ?', [$pattern])->exists();
    }
}
