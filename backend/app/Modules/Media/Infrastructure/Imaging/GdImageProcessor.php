<?php

namespace App\Modules\Media\Infrastructure\Imaging;

use App\Modules\Media\Domain\ImageEdit;
use App\Modules\Media\Domain\RenditionPlan;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use GdImage;

/**
 * B11: picture work with PHP's GD (no image package): reading (EXIF orientation applied),
 * scaling down, the editor's crop / rotate / flip / light and colour adjustments, and
 * writing JPEG, PNG or WebP. Written files carry no metadata (GD writes none), so a
 * re-encoded upload loses its EXIF block (camera, GPS) on the way.
 *
 * The light and colour adjustments reproduce CSS `brightness()`, `contrast()` and
 * `saturate()` (what the admin preview shows) with GD's filters: contrast is GD's own
 * formula; brightness is contrast around the middle grey plus a shift, which multiplies
 * every channel as CSS does; saturation blends with a grey copy (pictures with
 * transparency are blended pixel by pixel, because GD's merge drops transparency).
 */
final class GdImageProcessor
{
    /** Supported for scaling and editing; GIFs are left alone so animations survive. */
    public const EDITABLE = ['image/jpeg', 'image/png', 'image/webp'];

    /**
     * B22a: whether AVIF uploads are accepted — GD reads AVIF here and `media.avif` is not
     * switched off. AVIF originals are stored as uploaded; their renditions are WebP.
     */
    public function readsAvif(): bool
    {
        return config('media.avif', true) !== false
            && function_exists('imagecreatefromavif')
            && (gd_info()['AVIF Support'] ?? false) === true;
    }

    private const JPEG_QUALITY = 85;

    private const WEBP_QUALITY = 85;

    private const MEMORY_CAP = 1536 * 1024 * 1024;

    /**
     * A stored original that needs re-encoding: larger than RenditionPlan::MAX_SIDE, or a
     * JPEG whose EXIF orientation is not "upright". Null when the file can stay as it is.
     *
     * @return array{bytes: string, width: int, height: int}|null
     */
    public function normalizeUpload(string $path, string $mime, int $width, int $height): ?array
    {
        if (! in_array($mime, self::EDITABLE, true)) {
            return null;
        }
        $orientation = $mime === 'image/jpeg' ? $this->orientation($path) : 1;
        if ($orientation === 1 && ! RenditionPlan::isOversized($width, $height)) {
            return null;
        }

        $this->reserveMemory($width, $height, 2);
        $image = $this->decode((string) file_get_contents($path));
        $image = $this->orient($image, $orientation);
        $image = $this->fitWithin($image, RenditionPlan::MAX_SIDE);

        return ['bytes' => $this->encode($image, $mime), 'width' => imagesx($image), 'height' => imagesy($image)];
    }

    /**
     * Applies an edit to the bytes of a stored original.
     *
     * @return array{bytes: string, width: int, height: int}
     */
    public function edit(string $bytes, string $mime, int $width, int $height, ImageEdit $edit): array
    {
        if (! in_array($mime, self::EDITABLE, true)) {
            throw new BusinessRuleViolation('UNSUPPORTED_IMAGE', 'Only JPEG, PNG and WebP pictures can be edited (GIFs may be animated).');
        }
        $this->reserveMemory($width, $height, 3);
        $this->allowTime(120);

        $image = $this->decode($bytes);
        if ($edit->crop !== null) {
            $image = $this->crop($image, $edit->crop['x'], $edit->crop['y'], $edit->crop['w'], $edit->crop['h']);
        }
        if ($edit->rotate !== 0) {
            $image = $this->rotate($image, $edit->rotate);
        }
        if ($edit->flipH) {
            imageflip($image, IMG_FLIP_HORIZONTAL);
        }
        if ($edit->flipV) {
            imageflip($image, IMG_FLIP_VERTICAL);
        }
        $this->brightness($image, 1 + $edit->brightness / 100);
        $this->contrast($image, 1 + $edit->contrast / 100);
        $this->saturate($image, 1 + $edit->saturation / 100, $mime !== 'image/jpeg');

        return ['bytes' => $this->encode($image, $mime), 'width' => imagesx($image), 'height' => imagesy($image)];
    }

    /**
     * Scales the bytes of a stored original down to fit MAX_SIDE (for `media:optimize`).
     *
     * @return array{bytes: string, width: int, height: int}
     */
    public function shrink(string $bytes, string $mime, int $width, int $height): array
    {
        $this->reserveMemory($width, $height, 2);
        $image = $this->fitWithin($this->decode($bytes), RenditionPlan::MAX_SIDE);

        return ['bytes' => $this->encode($image, $mime), 'width' => imagesx($image), 'height' => imagesy($image)];
    }

    public function decode(string $bytes): GdImage
    {
        $image = @imagecreatefromstring($bytes);
        if (! $image instanceof GdImage) {
            throw new BusinessRuleViolation('INVALID_IMAGE', 'The file is not a readable image.');
        }
        if (! imageistruecolor($image)) {
            imagepalettetotruecolor($image);
        }
        imagealphablending($image, false);
        imagesavealpha($image, true);

        return $image;
    }

    public function encode(GdImage $image, string $mime): string
    {
        imagesavealpha($image, true);
        ob_start();
        match ($mime) {
            'image/png' => imagepng($image, null, 6),
            'image/webp' => imagewebp($image, null, self::WEBP_QUALITY),
            default => (function () use ($image) {
                imageinterlace($image, true);
                imagejpeg($image, null, self::JPEG_QUALITY);
            })(),
        };

        return (string) ob_get_clean();
    }

    /**
     * EXIF orientation (1–8) of a JPEG file; 1 when absent or unreadable.
     */
    public function orientation(string $path): int
    {
        if (! function_exists('exif_read_data')) {
            return 1;
        }
        $exif = @exif_read_data($path);
        $value = is_array($exif) ? (int) ($exif['Orientation'] ?? 1) : 1;

        return $value >= 1 && $value <= 8 ? $value : 1;
    }

    /**
     * Turns the stored pixels upright for an EXIF orientation.
     */
    public function orient(GdImage $image, int $orientation): GdImage
    {
        $rotate = match ($orientation) {
            3 => 180,
            5, 6 => 90,
            7, 8 => 270,
            default => 0,
        };
        if ($rotate !== 0) {
            $image = $this->rotate($image, $rotate);
        }
        if (in_array($orientation, [2, 5, 7], true)) {
            imageflip($image, IMG_FLIP_HORIZONTAL);
        }
        if ($orientation === 4) {
            imageflip($image, IMG_FLIP_VERTICAL);
        }

        return $image;
    }

    public function fitWithin(GdImage $image, int $max): GdImage
    {
        [$w, $h] = [imagesx($image), imagesy($image)];
        [$tw, $th] = RenditionPlan::fitWithin($w, $h, $max);
        if ($tw === $w && $th === $h) {
            return $image;
        }
        $scaled = $this->blank($tw, $th);
        imagecopyresampled($scaled, $image, 0, 0, 0, 0, $tw, $th, $w, $h);

        return $scaled;
    }

    private function crop(GdImage $image, int $x, int $y, int $w, int $h): GdImage
    {
        $cropped = $this->blank($w, $h);
        imagecopy($cropped, $image, 0, 0, $x, $y, $w, $h);

        return $cropped;
    }

    /** Clockwise by 90, 180 or 270 degrees (GD turns counter-clockwise). */
    private function rotate(GdImage $image, int $degrees): GdImage
    {
        $rotated = imagerotate($image, 360 - $degrees, (int) imagecolorallocatealpha($image, 0, 0, 0, 127));
        if (! $rotated instanceof GdImage) {
            throw new BusinessRuleViolation('INVALID_IMAGE', 'The picture could not be turned.');
        }
        imagealphablending($rotated, false);
        imagesavealpha($rotated, true);

        return $rotated;
    }

    /** CSS brightness(f): every channel × f. */
    private function brightness(GdImage $image, float $factor): void
    {
        if (abs($factor - 1) < 0.005) {
            return;
        }
        [$arg, $effective] = $this->contrastArgument($factor);
        if ($factor < 1) {
            // f·(p − 127.5) + 127.5 − 127.5·(1 − f) = f·p; neither step leaves 0…255.
            imagefilter($image, IMG_FILTER_CONTRAST, $arg);
            imagefilter($image, IMG_FILTER_BRIGHTNESS, (int) round(-127.5 * (1 - $effective)));

            return;
        }
        // (p + a − 127.5)·f + 127.5 = f·p for a = 127.5·(f − 1)/f; a pixel clipped at 255 by the
        // first step would end above 255 anyway.
        imagefilter($image, IMG_FILTER_BRIGHTNESS, (int) round(127.5 * ($effective - 1) / $effective));
        imagefilter($image, IMG_FILTER_CONTRAST, $arg);
    }

    /** CSS contrast(f): (p − middle grey) × f + middle grey — GD's own contrast formula. */
    private function contrast(GdImage $image, float $factor): void
    {
        if (abs($factor - 1) < 0.005) {
            return;
        }
        imagefilter($image, IMG_FILTER_CONTRAST, $this->contrastArgument($factor)[0]);
    }

    /** CSS saturate(f): grey + (p − grey) × f. */
    private function saturate(GdImage $image, float $factor, bool $mayHaveAlpha): void
    {
        if (abs($factor - 1) < 0.005) {
            return;
        }
        if ($mayHaveAlpha) {
            $this->saturatePixels($image, $factor);

            return;
        }
        [$w, $h] = [imagesx($image), imagesy($image)];
        $grey = $this->blank($w, $h);
        imagecopy($grey, $image, 0, 0, 0, 0, $w, $h);
        imagefilter($grey, IMG_FILTER_GRAYSCALE);
        if ($factor < 1) {
            imagecopymerge($image, $grey, 0, 0, 0, 0, $w, $h, (int) round((1 - $factor) * 100));

            return;
        }
        // p + k(p − g) for k = f − 1: blend with the inverted grey at k / (1 + 2k), then stretch
        // around the middle grey by 1 + 2k — exactly (1 + k)p − k·g, clipped once at the end.
        $k = $factor - 1;
        imagefilter($grey, IMG_FILTER_NEGATE);
        imagecopymerge($image, $grey, 0, 0, 0, 0, $w, $h, (int) round(100 * $k / (1 + 2 * $k)));
        imagefilter($image, IMG_FILTER_CONTRAST, $this->contrastArgument(1 + 2 * $k)[0]);
    }

    private function saturatePixels(GdImage $image, float $factor): void
    {
        [$w, $h] = [imagesx($image), imagesy($image)];
        imagealphablending($image, false);
        for ($y = 0; $y < $h; $y++) {
            for ($x = 0; $x < $w; $x++) {
                $c = imagecolorat($image, $x, $y);
                $a = ($c >> 24) & 0x7F;
                if ($a === 127) {
                    continue;
                }
                $r = ($c >> 16) & 0xFF;
                $g = ($c >> 8) & 0xFF;
                $b = $c & 0xFF;
                $l = 0.2126 * $r + 0.7152 * $g + 0.0722 * $b;
                $r = (int) max(0, min(255, round($l + ($r - $l) * $factor)));
                $g = (int) max(0, min(255, round($l + ($g - $l) * $factor)));
                $b = (int) max(0, min(255, round($l + ($b - $l) * $factor)));
                imagesetpixel($image, $x, $y, ($a << 24) | ($r << 16) | ($g << 8) | $b);
            }
        }
    }

    /**
     * GD's contrast argument for a CSS contrast factor, and the factor it really applies
     * (GD: ((100 − arg) / 100)²).
     *
     * @return array{0: int, 1: float}
     */
    private function contrastArgument(float $factor): array
    {
        $arg = (int) round(100 - 100 * sqrt(max(0.0, $factor)));

        return [$arg, ((100 - $arg) / 100) ** 2];
    }

    private function blank(int $w, int $h): GdImage
    {
        $image = imagecreatetruecolor($w, $h);
        imagealphablending($image, false);
        imagesavealpha($image, true);
        imagefill($image, 0, 0, (int) imagecolorallocatealpha($image, 0, 0, 0, 127));

        return $image;
    }

    /**
     * GD keeps 4 bytes per pixel; raises PHP's memory limit (up to a cap) for $copies
     * pictures of this size, or refuses when even that is not enough.
     */
    private function reserveMemory(int $width, int $height, int $copies): void
    {
        $needed = memory_get_usage() + $width * $height * 5 * $copies + 32 * 1024 * 1024;
        $limit = $this->bytes((string) ini_get('memory_limit'));
        if ($limit < 0 || $needed <= $limit) {
            return;
        }
        if ($needed > self::MEMORY_CAP) {
            throw new BusinessRuleViolation('IMAGE_TOO_LARGE', 'The picture is too large to process.');
        }
        ini_set('memory_limit', (string) $needed);
    }

    /**
     * Gives a web request at least $seconds for the GD work. Never in the console: there
     * set_time_limit() would put the whole process (test run, queue worker, media:optimize) on
     * a clock that has none by default; queue jobs have their own timeout.
     */
    public function allowTime(int $seconds): bool
    {
        if (app()->runningInConsole()) {
            return false;
        }
        $current = (int) ini_get('max_execution_time');
        if ($current === 0 || $current >= $seconds) {
            return false;
        }

        return @set_time_limit($seconds);
    }

    private function bytes(string $value): int
    {
        $value = trim($value);
        if ($value === '' || $value === '-1') {
            return -1;
        }
        $number = (int) $value;

        return match (strtolower(substr($value, -1))) {
            'g' => $number * 1024 ** 3,
            'm' => $number * 1024 ** 2,
            'k' => $number * 1024,
            default => $number,
        };
    }
}
