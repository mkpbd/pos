<?php

namespace App\Modules\Media\Domain;

/**
 * Which downscaled copies an image gets: every standard width narrower than the
 * original. Images are never upscaled.
 *
 * B11 limits: originals larger than MAX_SIDE px on either side are scaled down on upload
 * (aspect kept); JPEG and PNG originals heavier than FULL_SIZE_WEBP_MIN_BYTES also get a
 * WebP copy at their own width (kept only when it is smaller than the original).
 */
final class RenditionPlan
{
    public const WIDTHS = [320, 640, 1280];

    /** Longest side an original is stored with (px). */
    public const MAX_SIDE = 2560;

    /** JPEG/PNG originals above this size (bytes) get a full-size WebP rendition. */
    public const FULL_SIZE_WEBP_MIN_BYTES = 300 * 1024;

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

    public static function wantsFullSizeWebp(string $mimeType, int $bytes): bool
    {
        return in_array($mimeType, ['image/jpeg', 'image/png'], true) && $bytes > self::FULL_SIZE_WEBP_MIN_BYTES;
    }

    public static function isOversized(int $width, int $height): bool
    {
        return $width > self::MAX_SIDE || $height > self::MAX_SIDE;
    }

    /**
     * The size an original is stored at: within MAX_SIDE × MAX_SIDE, aspect kept, never upscaled.
     *
     * @return array{0: int, 1: int}
     */
    public static function fitWithin(int $width, int $height, int $max = self::MAX_SIDE): array
    {
        if ($width <= $max && $height <= $max) {
            return [$width, $height];
        }
        $scale = $max / max($width, $height);

        return [max(1, (int) round($width * $scale)), max(1, (int) round($height * $scale))];
    }
}
