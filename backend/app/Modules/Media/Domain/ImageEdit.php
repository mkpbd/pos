<?php

namespace App\Modules\Media\Domain;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * B11: what the picture editor asks for, applied in this order (the order the admin
 * preview's CSS uses): crop (a box in the source picture's pixels, before rotating) →
 * rotate clockwise → flip → brightness → contrast → saturation. The three adjustments run
 * from −50 to +50 and mean what CSS `brightness()`, `contrast()` and `saturate()` mean at
 * 1 + value / 100.
 */
final class ImageEdit
{
    public const ROTATIONS = [0, 90, 180, 270];

    public const ADJUST_MIN = -50;

    public const ADJUST_MAX = 50;

    /**
     * @param  array{x: int, y: int, w: int, h: int}|null  $crop
     */
    public function __construct(
        public readonly ?array $crop = null,
        public readonly int $rotate = 0,
        public readonly bool $flipH = false,
        public readonly bool $flipV = false,
        public readonly int $brightness = 0,
        public readonly int $contrast = 0,
        public readonly int $saturation = 0,
    ) {}

    /**
     * @param  array<string, mixed>  $data  validated request data
     */
    public static function fromArray(array $data): self
    {
        $crop = $data['crop'] ?? null;

        return new self(
            is_array($crop) ? ['x' => (int) $crop['x'], 'y' => (int) $crop['y'], 'w' => (int) $crop['w'], 'h' => (int) $crop['h']] : null,
            (int) ($data['rotate'] ?? 0),
            (bool) ($data['flip_h'] ?? false),
            (bool) ($data['flip_v'] ?? false),
            (int) ($data['brightness'] ?? 0),
            (int) ($data['contrast'] ?? 0),
            (int) ($data['saturation'] ?? 0),
        );
    }

    /**
     * Refuses a crop box outside the picture. A box covering the whole picture is no crop.
     */
    public function forSource(int $width, int $height): self
    {
        $crop = $this->crop;
        if ($crop !== null) {
            if ($crop['x'] < 0 || $crop['y'] < 0 || $crop['w'] < 1 || $crop['h'] < 1
                || $width < $crop['x'] + $crop['w'] || $height < $crop['y'] + $crop['h']) {
                throw new BusinessRuleViolation('INVALID_CROP', 'The crop box must lie inside the picture.', ['width' => $width, 'height' => $height]);
            }
            if ($crop['x'] === 0 && $crop['y'] === 0 && $crop['w'] === $width && $crop['h'] === $height) {
                $crop = null;
            }
        }

        return new self($crop, $this->rotate, $this->flipH, $this->flipV, $this->brightness, $this->contrast, $this->saturation);
    }

    public function changesPixels(): bool
    {
        return $this->crop !== null || $this->rotate !== 0 || $this->flipH || $this->flipV
            || $this->brightness !== 0 || $this->contrast !== 0 || $this->saturation !== 0;
    }

    public function changesGeometry(): bool
    {
        return $this->crop !== null || $this->rotate !== 0 || $this->flipH || $this->flipV;
    }

    /**
     * Width and height of the result.
     *
     * @return array{0: int, 1: int}
     */
    public function outputSize(int $width, int $height): array
    {
        [$w, $h] = $this->crop === null ? [$width, $height] : [$this->crop['w'], $this->crop['h']];

        return $this->rotate === 90 || $this->rotate === 270 ? [$h, $w] : [$w, $h];
    }

    /**
     * For the audit log.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return array_filter([
            'crop' => $this->crop,
            'rotate' => $this->rotate,
            'flip_h' => $this->flipH,
            'flip_v' => $this->flipV,
            'brightness' => $this->brightness,
            'contrast' => $this->contrast,
            'saturation' => $this->saturation,
        ], fn ($v) => $v !== null && $v !== 0 && $v !== false);
    }
}
