<?php

namespace App\Modules\Orders\Infrastructure\Models;

use App\Modules\Sales\Infrastructure\Models\AppendOnly;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * What one order line took from one batch (or from untracked-batch stock), at what cost.
 * Cancelling the order puts exactly this back. Append-only.
 *
 * @property string $id
 * @property string $order_line_id
 * @property ?string $batch_id
 * @property string $quantity
 * @property string $unit_cost
 * @property ?string $movement_id
 */
#[Table('order_line_stock', timestamps: false)]
#[Fillable(['organization_id', 'order_line_id', 'batch_id', 'quantity', 'unit_cost', 'movement_id'])]
class OrderLineStock extends Model
{
    use AppendOnly, BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return ['quantity' => 'decimal:3', 'unit_cost' => 'decimal:4'];
    }
}
