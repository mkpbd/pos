<?php

namespace App\Modules\Purchasing\Infrastructure\Models;

use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $purchase_requisition_id
 * @property string $variant_id
 * @property string $quantity
 * @property string $estimated_unit_cost
 * @property string $tax_rate
 * @property string $line_total
 * @property ?string $suggested_supplier_id
 * @property ?string $notes
 * @property string $converted_quantity
 * @property int $sort_order
 */
#[Table(timestamps: false)]
#[Fillable([
    'organization_id', 'purchase_requisition_id', 'variant_id', 'quantity', 'estimated_unit_cost', 'tax_rate', 'line_total',
    'suggested_supplier_id', 'notes', 'converted_quantity', 'sort_order',
])]
class PurchaseRequisitionLine extends Model
{
    use BelongsToOrganization, HasUuids;

    protected $attributes = ['converted_quantity' => '0'];

    protected function casts(): array
    {
        return [
            'quantity' => 'decimal:3',
            'estimated_unit_cost' => 'decimal:4',
            'tax_rate' => 'decimal:4',
            'line_total' => 'decimal:2',
            'converted_quantity' => 'decimal:3',
            'sort_order' => 'integer',
        ];
    }

    public function remainingQuantity(): string
    {
        return Decimal::max(Decimal::sub($this->quantity, $this->converted_quantity, 3), '0.000');
    }
}
