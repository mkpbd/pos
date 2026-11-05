<?php

namespace App\Modules\OnlineCatalog\Application\Actions;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * Shared checks of the category and brand listing editors.
 *
 * @internal
 */
final class ListingMedia
{
    public const AUDITED_CATEGORY = ['slug', 'is_visible', 'image_media_id', 'banner_media_id', 'seo_title', 'seo_description', 'translations'];

    public const AUDITED_BRAND = ['slug', 'is_visible', 'logo_media_id', 'description', 'seo_title', 'seo_description', 'translations'];

    /**
     * @param  list<?string>  $ids
     */
    public static function assertExist(MediaLibrary $media, array $ids): void
    {
        $ids = array_values(array_unique(array_filter($ids, 'is_string')));
        $missing = array_values(array_diff($ids, $media->existing($ids)));
        if ($missing !== []) {
            throw new BusinessRuleViolation('MEDIA_NOT_FOUND', 'Some selected images no longer exist in the media library.', ['media_ids' => $missing]);
        }
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public static function blankToNull(array $data): array
    {
        foreach (['seo_title', 'seo_description', 'description'] as $key) {
            if (array_key_exists($key, $data) && is_string($data[$key]) && trim($data[$key]) === '') {
                $data[$key] = null;
            }
        }

        return $data;
    }
}
