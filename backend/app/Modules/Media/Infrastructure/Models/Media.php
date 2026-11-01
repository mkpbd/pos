<?php

namespace App\Modules\Media\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Storage;

/**
 * @property string $id
 * @property string $organization_id
 * @property string $disk
 * @property string $path
 * @property string $original_name
 * @property string $mime_type
 * @property int $size
 * @property int $width
 * @property int $height
 * @property ?string $alt
 * @property array<string, string> $renditions
 * @property string $checksum
 */
#[Fillable(['organization_id', 'disk', 'path', 'original_name', 'mime_type', 'size', 'width', 'height', 'alt', 'renditions', 'checksum'])]
class Media extends Model
{
    use BelongsToOrganization, ChangesStorefrontContent, HasUuids, TracksAuthor;

    protected $table = 'media';

    protected $attributes = [
        'renditions' => '{}',
    ];

    protected function casts(): array
    {
        return [
            'size' => 'integer',
            'width' => 'integer',
            'height' => 'integer',
            'renditions' => 'array',
        ];
    }

    public function url(): string
    {
        return self::urlFor($this->disk, $this->path);
    }

    /**
     * `srcset` of the original plus its generated renditions (narrowest first).
     */
    public function srcset(): string
    {
        $candidates = [];
        foreach ($this->renditions as $width => $path) {
            $candidates[(int) $width] = self::urlFor($this->disk, $path);
        }
        $candidates[$this->width] = $this->url();
        ksort($candidates);

        return implode(', ', array_map(fn (int $w, string $url) => "{$url} {$w}w", array_keys($candidates), $candidates));
    }

    /**
     * All files belonging to this media item (original and renditions).
     *
     * @return list<string>
     */
    public function files(): array
    {
        return [$this->path, ...array_values($this->renditions)];
    }

    /**
     * Public disk files are served same-origin under /storage (as product images are);
     * other disks (S3/CDN in production) build their own absolute URLs.
     */
    public static function urlFor(string $disk, string $path): string
    {
        return $disk === 'public' ? '/storage/'.ltrim($path, '/') : Storage::disk($disk)->url($path);
    }
}
