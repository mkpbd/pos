<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $organization_id
 * @property string $host lower-case, without port
 * @property bool $is_primary
 * @property ?string $entry_path P2a: the store path the host's `/` shows (e.g. `/p/eid-sale`), null = home
 */
#[Fillable(['organization_id', 'host', 'is_primary', 'entry_path'])]
class StorefrontDomain extends Model
{
    use BelongsToOrganization, ChangesStorefrontContent, HasUuids, TracksAuthor;

    protected $attributes = [
        'is_primary' => false,
    ];

    protected function casts(): array
    {
        return ['is_primary' => 'boolean'];
    }
}
