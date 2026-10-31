<?php

namespace App\Modules\Inventory\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Posted stock adjustment (opening stock, count differences, damage, …). Immutable once saved.
 *
 * @property string $id
 * @property string $branch_id
 * @property string $store_id
 * @property string $number
 * @property string $reason
 * @property ?string $note
 * @property ?string $created_by
 */
#[Fillable(['organization_id', 'branch_id', 'store_id', 'number', 'reason', 'note', 'created_by'])]
class StockAdjustment extends Model
{
    use BelongsToOrganization, HasUuids;

    /**
     * @return HasMany<StockAdjustmentLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(StockAdjustmentLine::class);
    }
}
