<?php

namespace App\Modules\Storefront\Infrastructure;

use App\Modules\Media\Application\Contracts\MediaReferences;
use App\Modules\Storefront\Infrastructure\Models\HomepageSection;

/**
 * Homepage sections keep media ids inside their config (testimonial photos, newsletter
 * image); this stops the media library from deleting them. Banner images are real
 * foreign keys, and images inside rich text are not tracked (like any pasted link).
 */
class SectionMediaReferences implements MediaReferences
{
    public function uses(string $mediaId): bool
    {
        return HomepageSection::query()->get(['id', 'type', 'config'])
            ->contains(fn (HomepageSection $s) => in_array($mediaId, $s->type->mediaIds($s->type->normalize($s->config)), true));
    }
}
