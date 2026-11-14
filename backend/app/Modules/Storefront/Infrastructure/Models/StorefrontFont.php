<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use App\Modules\Storefront\Domain\ThemeSchema;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Storage;

/**
 * B10: an organization's own font (a WOFF2 file) for the storefront theme, referred to as
 * `custom:<id>` in the theme's font roles. The file never changes after upload, so it can be
 * cached for good.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $name
 * @property int $weight_min
 * @property int $weight_max
 * @property string $disk
 * @property string $path
 * @property int $size
 * @property string $checksum
 * @property ?CarbonImmutable $created_at
 */
#[Fillable(['organization_id', 'name', 'weight_min', 'weight_max', 'disk', 'path', 'size', 'checksum'])]
class StorefrontFont extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    protected $table = 'storefront_fonts';

    protected function casts(): array
    {
        return [
            'weight_min' => 'integer',
            'weight_max' => 'integer',
            'size' => 'integer',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * The theme's id for this font.
     */
    public function key(): string
    {
        return ThemeSchema::CUSTOM_FONT_PREFIX.$this->id;
    }

    /**
     * The CSS font-family name for `@font-face` (opaque and CSS-safe: never the owner's text).
     */
    public function family(): string
    {
        return 'sf-custom-'.substr(str_replace('-', '', $this->id), 0, 12);
    }

    /**
     * Public disk files are served same-origin under /storage (like media); other disks (S3/CDN)
     * build their own absolute URLs.
     */
    public function url(): string
    {
        return $this->disk === 'public' ? '/storage/'.ltrim($this->path, '/') : Storage::disk($this->disk)->url($this->path);
    }
}
