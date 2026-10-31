<?php

namespace App\Modules\Media\Domain;

/**
 * Which downscaled copies an image gets: every standard width narrower than the
 * original. Images are never upscaled.
 */
final class RenditionPlan
{
    public const WIDTHS = [320, 640, 1280];

    /**
     * @return list<int>
     */
    public static function widthsFor(int $originalWidth): array
    {
        return array_values(array_filter(self::WIDTHS, fn (int $w) => $w < $originalWidth));
    }

    public static function heightFor(int $width, int $originalWidth, int $originalHeight): int
    {
        return max(1, (int) round($originalHeight * $width / $originalWidth));
    }
}
