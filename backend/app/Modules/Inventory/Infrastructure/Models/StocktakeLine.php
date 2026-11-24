<?php

namespace App\Modules\Inventory\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * ST1: one product (× batch) of a stocktake.
 *
 * @property string $id
 * @property string $stocktake_id
 * @property string $variant_id
 * @property ?string $batch_id
 * @property int $position
 * @property bool $is_extra
 * @property ?string $system_quantity
 * @property ?string $counted_quantity
 * @property ?Carbon $counted_at
 * @property ?string $counted_by
 * @property ?string $note
 */
#[Fillable(['organization_id', 'stocktake_id', 'variant_id', 'batch_id', 'position', 'is_extra', 'system_quantity', 'counted_quantity', 'counted_at', 'counted_by', 'note'])]
class StocktakeLine extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'position' => 'integer',
            'is_extra' => 'boolean',
            'system_quantity' => 'decimal:3',
            'counted_quantity' => 'decimal:3',
            'counted_at' => 'datetime',
        ];
    }
}
