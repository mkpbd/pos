<?php

namespace App\Modules\Inventory\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property string $id
 * @property string $variant_id
 * @property ?string $batch_id
 * @property string $quantity signed
 * @property string $unit_cost
 * @property ?string $counted_quantity Q1 stock count: what was counted (null on signed lines)
 * @property ?string $system_quantity Q1 stock count: on hand when counted, read under the row lock
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'stock_adjustment_id', 'variant_id', 'batch_id', 'quantity', 'unit_cost', 'counted_quantity', 'system_quantity'])]
class StockAdjustmentLine extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'quantity' => 'decimal:3',
            'unit_cost' => 'decimal:4',
            'counted_quantity' => 'decimal:3',
            'system_quantity' => 'decimal:3',
        ];
    }

    /**
     * @return BelongsTo<Batch, $this>
     */
    public function batch(): BelongsTo
    {
        return $this->belongsTo(Batch::class);
    }
}
