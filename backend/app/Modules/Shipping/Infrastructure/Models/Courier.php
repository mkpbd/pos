<?php

namespace App\Modules\Shipping\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * A courier company the store hands parcels to (E10a).
 *
 * @property string $id
 * @property string $organization_id
 * @property string $name
 * @property ?string $phone
 * @property ?string $tracking_url_template contains `{tracking}`
 * @property bool $is_active
 * @property int $sort_order
 */
#[Fillable(['organization_id', 'name', 'phone', 'tracking_url_template', 'is_active', 'sort_order'])]
class Courier extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    protected $attributes = [
        'is_active' => true,
        'sort_order' => 0,
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'sort_order' => 'integer',
        ];
    }
}
