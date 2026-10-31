<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $organization_id
 * @property bool $is_enabled
 * @property string $site_name
 * @property ?string $meta_description
 */
#[Fillable(['organization_id', 'is_enabled', 'site_name', 'meta_description'])]
class StorefrontSettings extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    protected $table = 'storefront_settings';

    protected $attributes = [
        'is_enabled' => false,
    ];

    protected function casts(): array
    {
        return ['is_enabled' => 'boolean'];
    }
}
