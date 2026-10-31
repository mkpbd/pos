<?php

namespace App\Modules\Sales\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $name
 * @property bool $restock_by_default
 * @property bool $is_active
 */
#[Fillable(['organization_id', 'name', 'restock_by_default', 'is_active'])]
class ReturnReason extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    protected $attributes = [
        'restock_by_default' => true,
        'is_active' => true,
    ];

    protected function casts(): array
    {
        return [
            'restock_by_default' => 'boolean',
            'is_active' => 'boolean',
        ];
    }
}
