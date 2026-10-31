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
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'goods_receipt_id', 'purchase_order_line_id', 'variant_id', 'batch_id', 'quantity', 'unit_cost', 'tax_rate', 'line_subtotal', 'line_tax', 'line_total', 'returned_quantity'])]
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
            'returned_quantity' => 'decimal:3',
        ];
    }
}
