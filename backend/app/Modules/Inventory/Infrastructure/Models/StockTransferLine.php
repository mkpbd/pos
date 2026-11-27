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
 * @property string $quantity
 * @property string $unit_cost captured at dispatch
 * @property ?string $received_quantity set when received (null before)
 * @property string $damaged_quantity
 * @property ?string $requested_quantity set on lines of a transfer request
 * @property ?string $receive_note
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'stock_transfer_id', 'variant_id', 'batch_id', 'quantity', 'unit_cost', 'received_quantity', 'damaged_quantity', 'requested_quantity', 'receive_note'])]
class StockTransferLine extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'quantity' => 'decimal:3',
            'unit_cost' => 'decimal:4',
            'received_quantity' => 'decimal:3',
            'damaged_quantity' => 'decimal:3',
            'requested_quantity' => 'decimal:3',
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
