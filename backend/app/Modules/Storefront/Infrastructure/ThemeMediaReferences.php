<?php

namespace App\Modules\Storefront\Infrastructure;

use App\Modules\Media\Application\Contracts\MediaReferences;
use App\Modules\Storefront\Domain\ThemeSchema;
use App\Modules\Storefront\Infrastructure\Models\ThemeSettings;

/**
 * The theme keeps media ids inside its JSON settings (logo, favicon, payment logos);
 * this stops the media library from deleting them. Menu images are real foreign keys.
 */
class ThemeMediaReferences implements MediaReferences
{
    public function uses(string $mediaId): bool
    {
        $theme = ThemeSettings::query()->first();

        return $theme !== null && in_array($mediaId, ThemeSchema::mediaIds(ThemeSchema::normalize($theme->settings)), true);
    }
}
