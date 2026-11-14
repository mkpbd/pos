<?php

namespace App\Modules\OnlineCatalog\Infrastructure;

use App\Modules\Media\Application\Contracts\MediaReferences;
use App\Modules\OnlineCatalog\Infrastructure\Models\BrandListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\CategoryListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\SizeGuide;

/**
 * Category images/banners and brand logos keep their media from being deleted (the foreign
 * keys would refuse too; this gives the library's friendly "in use" answer first).
 */
class ListingMediaReferences implements MediaReferences
{
    public function uses(string $mediaId): bool
    {
        return CategoryListing::query()->where(fn ($q) => $q->where('image_media_id', $mediaId)->orWhere('banner_media_id', $mediaId))->exists()
            || BrandListing::query()->where('logo_media_id', $mediaId)->exists()
            || SizeGuide::query()->where('image_media_id', $mediaId)->exists();
    }
}
