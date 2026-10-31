<?php

namespace App\Modules\OnlineCatalog\Domain;

use DateTimeInterface;

/**
 * Where a product listing stands: `draft` (not published), `scheduled` (published, window not
 * started), `live` or `expired` (window over). Only live listings are visible to shoppers.
 */
enum ListingState: string
{
    case Draft = 'draft';
    case Scheduled = 'scheduled';
    case Live = 'live';
    case Expired = 'expired';

    public static function of(bool $isPublished, ?DateTimeInterface $publishedAt, ?DateTimeInterface $unpublishedAt, DateTimeInterface $now): self
    {
        return match (true) {
            ! $isPublished => self::Draft,
            $publishedAt !== null && $publishedAt > $now => self::Scheduled,
            $unpublishedAt !== null && $unpublishedAt <= $now => self::Expired,
            default => self::Live,
        };
    }
}
