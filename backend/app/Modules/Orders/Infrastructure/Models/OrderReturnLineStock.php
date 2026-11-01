<?php

namespace App\Modules\Orders\Infrastructure\Models;

use App\Modules\Sales\Infrastructure\Models\AppendOnly;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * Which order line allocation (batch, cost) restocked goods of a return went back to (E10b).
 * Append-only.
 *
 * @property string $id
 * @property string $return_line_id
 * @property string $order_line_stock_id
 * @property ?string $batch_id
 * @property string $quantity
 * @property string $unit_cost
 * @property ?string $movement_id
 */
#[Table('order_return_line_stock', timestamps: false)]
#[Fillable(['organization_id', 'return_line_id', 'order_line_stock_id', 'batch_id', 'quantity', 'unit_cost', 'movement_id'])]
class OrderReturnLineStock extends Model
{
    use AppendOnly, BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return ['quantity' => 'decimal:3', 'unit_cost' => 'decimal:4'];
    }
}
