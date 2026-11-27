<?php

namespace App\Modules\Inventory\Infrastructure\Models;

use App\Modules\Inventory\Domain\TransferStatus;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property string $number
 * @property string $from_branch_id
 * @property string $from_store_id
 * @property string $to_branch_id
 * @property string $to_store_id
 * @property TransferStatus $status
 * @property ?string $note
 * @property ?string $dispatched_by
 * @property ?Carbon $dispatched_at
 * @property ?string $completed_by
 * @property ?Carbon $completed_at
 * @property ?string $requested_by
 * @property ?Carbon $requested_at
 * @property ?string $rejected_by
 * @property ?Carbon $rejected_at
 * @property ?string $rejection_reason
 * @property string $loss_total
 */
#[Fillable([
    'organization_id', 'number', 'from_branch_id', 'from_store_id', 'to_branch_id', 'to_store_id', 'status', 'note',
    'dispatched_by', 'dispatched_at', 'completed_by', 'completed_at',
    'requested_by', 'requested_at', 'rejected_by', 'rejected_at', 'rejection_reason', 'loss_total',
])]
class StockTransfer extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'status' => TransferStatus::class,
            'dispatched_at' => 'datetime',
            'completed_at' => 'datetime',
            'requested_at' => 'datetime',
            'rejected_at' => 'datetime',
            'loss_total' => 'decimal:2',
        ];
    }

    /**
     * @return HasMany<StockTransferLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(StockTransferLine::class);
    }
}
