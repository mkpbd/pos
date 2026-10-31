<?php

namespace App\Modules\Inventory\Infrastructure\Models;

use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use LogicException;

/**
 * Append-only ledger row (also enforced by a PostgreSQL trigger).
 *
 * @property string $id
 * @property string $branch_id
 * @property string $store_id
 * @property string $variant_id
 * @property ?string $batch_id
 * @property MovementType $type
 * @property string $quantity
 * @property string $unit_cost
 * @property string $balance_after
 * @property string $reference_type
 * @property string $reference_id
 * @property ?string $reference_number
 * @property ?string $created_by
 * @property Carbon $created_at
 */
#[Table(timestamps: false)]
#[Fillable([
    'organization_id', 'branch_id', 'store_id', 'variant_id', 'batch_id', 'type', 'quantity', 'unit_cost',
    'balance_after', 'reference_type', 'reference_id', 'reference_number', 'created_by', 'created_at',
])]
class StockMovement extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'type' => MovementType::class,
            'quantity' => 'decimal:3',
            'unit_cost' => 'decimal:4',
            'balance_after' => 'decimal:3',
            'created_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Stock movements are immutable.'));
        static::deleting(fn () => throw new LogicException('Stock movements are immutable.'));
    }

    /**
     * @return BelongsTo<Batch, $this>
     */
    public function batch(): BelongsTo
    {
        return $this->belongsTo(Batch::class);
    }
}
