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
 * @property Carbon $dispatched_at
 * @property ?string $completed_by
 * @property ?Carbon $completed_at
 */
#[Fillable([
    'organization_id', 'number', 'from_branch_id', 'from_store_id', 'to_branch_id', 'to_store_id', 'status', 'note',
    'dispatched_by', 'dispatched_at', 'completed_by', 'completed_at',
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
