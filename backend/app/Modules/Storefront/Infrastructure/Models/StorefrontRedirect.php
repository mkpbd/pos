<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * B16: a storefront redirect — `from_path` (normalized, see RedirectPaths) answered with a 301 or
 * 302 to `to_path` (a store path, or an http(s) URL for manual redirects). `source` auto | manual.
 * Served only for addresses that are not a live page (StorefrontRedirects::match()).
 *
 * @property string $id
 * @property string $organization_id
 * @property string $from_path
 * @property string $to_path
 * @property int $type
 * @property string $source
 * @property int $hits
 * @property ?CarbonImmutable $last_hit_at
 * @property ?string $created_by
 * @property ?CarbonImmutable $created_at
 * @property ?CarbonImmutable $updated_at
 */
#[Fillable(['organization_id', 'from_path', 'to_path', 'type', 'source', 'hits', 'last_hit_at', 'created_by'])]
class StorefrontRedirect extends Model
{
    use BelongsToOrganization, HasUuids;

    public const SOURCE_AUTO = 'auto';

    public const SOURCE_MANUAL = 'manual';

    public const SOURCES = [self::SOURCE_AUTO, self::SOURCE_MANUAL];

    public const TYPES = [301, 302];

    protected $table = 'storefront_redirects';

    protected $attributes = [
        'type' => 301,
        'source' => self::SOURCE_MANUAL,
        'hits' => 0,
    ];

    protected function casts(): array
    {
        return [
            'type' => 'integer',
            'hits' => 'integer',
            'last_hit_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * Whether the target is an address of this store (a path), not an outside URL.
     */
    public function isInternal(): bool
    {
        return str_starts_with($this->to_path, '/');
    }
}
