<?php

namespace App\Modules\Orders\Infrastructure\Models;

use App\Modules\Sales\Infrastructure\Models\AppendOnly;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One order paid by a COD remittance (the order total). Append-only.
 *
 * @property string $id
 * @property string $remittance_id
 * @property string $order_id
 * @property string $amount
 * @property-read Order $order
 */
#[Table('cod_remittance_lines', timestamps: false)]
#[Fillable(['organization_id', 'remittance_id', 'order_id', 'amount'])]
class CodRemittanceLine extends Model
{
    use AppendOnly, BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return ['amount' => 'decimal:2'];
    }

    /**
     * @return BelongsTo<Order, $this>
     */
    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }
}
