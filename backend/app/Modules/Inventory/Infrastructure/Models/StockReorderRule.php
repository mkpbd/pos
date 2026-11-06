<?php

namespace App\Modules\Inventory\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Reorder point (min) and order-up-to level (max) of a variant in one store (SC1).
 *
 * @property string $id
 * @property string $branch_id
 * @property string $store_id
 * @property string $variant_id
 * @property string $min_qty
 * @property ?string $max_qty
 * @property bool $is_active
 * @property ?Carbon $updated_at
 */
#[Fillable(['organization_id', 'branch_id', 'store_id', 'variant_id', 'min_qty', 'max_qty', 'is_active'])]
class StockReorderRule extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    protected $attributes = ['is_active' => true];

    protected function casts(): array
    {
        return [
            'min_qty' => 'decimal:3',
            'max_qty' => 'decimal:3',
            'is_active' => 'boolean',
        ];
    }
}
