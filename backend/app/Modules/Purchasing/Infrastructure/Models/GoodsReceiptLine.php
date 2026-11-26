<?php

namespace App\Modules\Purchasing\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $goods_receipt_id
 * @property ?string $purchase_order_line_id
 * @property string $variant_id
 * @property ?string $batch_id
 * @property string $quantity
 * @property string $returned_quantity
 * @property string $unit_cost
 * @property string $tax_rate
 * @property string $line_subtotal
 * @property string $line_tax
 * @property string $line_total
 * @property string $landed_cost SC3: the line's share of the receipt's charges
 * @property string $landed_unit_cost SC3: effective_unit_cost + landed_cost / (quantity + bonus_quantity) (the cost stock entered at)
 * @property string $discount_percent ST2a: line discount %
 * @property string $bonus_quantity ST2a: free units received on top of the quantity
 * @property string $effective_unit_cost ST2a: unit_cost × (100 − discount %) / 100 × quantity / (quantity + bonus_quantity), 4 dp
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'goods_receipt_id', 'purchase_order_line_id', 'variant_id', 'batch_id', 'quantity', 'unit_cost', 'tax_rate', 'line_subtotal', 'line_tax', 'line_total', 'landed_cost', 'landed_unit_cost', 'returned_quantity', 'discount_percent', 'bonus_quantity', 'effective_unit_cost'])]
class GoodsReceiptLine extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'quantity' => 'decimal:3',
            'unit_cost' => 'decimal:4',
            'tax_rate' => 'decimal:4',
            'line_subtotal' => 'decimal:2',
            'line_tax' => 'decimal:2',
            'line_total' => 'decimal:2',
            'landed_cost' => 'decimal:2',
            'landed_unit_cost' => 'decimal:4',
            'returned_quantity' => 'decimal:3',
            'discount_percent' => 'decimal:4',
            'bonus_quantity' => 'decimal:3',
            'effective_unit_cost' => 'decimal:4',
        ];
    }
}
