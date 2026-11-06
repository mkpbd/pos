<?php

namespace App\Modules\Purchasing\Infrastructure\Models;

use App\Modules\Sales\Infrastructure\Models\AppendOnly;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * SC3: what a posted landed cost voucher put on one receipt line (append-only): the amount,
 * split into the share on hand (value-only stock movement) and the share consumed (expense).
 *
 * @property string $id
 * @property string $landed_cost_voucher_id
 * @property string $goods_receipt_id
 * @property string $goods_receipt_line_id
 * @property string $variant_id
 * @property string $store_id
 * @property ?string $batch_id
 * @property string $received_quantity
 * @property string $on_hand_quantity
 * @property string $amount
 * @property string $on_hand_amount
 * @property string $consumed_amount
 * @property ?string $average_cost_before
 * @property ?string $average_cost_after
 * @property ?string $stock_movement_id
 * @property Carbon $created_at
 */
#[Table(timestamps: false)]
#[Fillable([
    'organization_id', 'landed_cost_voucher_id', 'goods_receipt_id', 'goods_receipt_line_id', 'variant_id', 'store_id', 'batch_id',
    'received_quantity', 'on_hand_quantity', 'amount', 'on_hand_amount', 'consumed_amount', 'average_cost_before',
    'average_cost_after', 'stock_movement_id', 'sort_order', 'created_at',
])]
class LandedCostAllocation extends Model
{
    use AppendOnly, BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'received_quantity' => 'decimal:3',
            'on_hand_quantity' => 'decimal:3',
            'amount' => 'decimal:2',
            'on_hand_amount' => 'decimal:2',
            'consumed_amount' => 'decimal:2',
            'average_cost_before' => 'decimal:4',
            'average_cost_after' => 'decimal:4',
            'created_at' => 'datetime',
        ];
    }
}
