<?php

namespace App\Modules\Purchasing\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * Goods received from a supplier, which is also the supplier's invoice (the payable).
 *
 * @property string $id
 * @property string $number
 * @property string $supplier_id
 * @property string $branch_id
 * @property string $store_id
 * @property ?string $purchase_order_id
 * @property ?string $supplier_invoice_number
 * @property Carbon $invoice_date
 * @property ?Carbon $due_date
 * @property ?string $notes
 * @property string $currency
 * @property string $subtotal
 * @property string $tax_total
 * @property string $total
 * @property ?string $created_by
 */
#[Fillable([
    'organization_id', 'number', 'supplier_id', 'branch_id', 'store_id', 'purchase_order_id', 'supplier_invoice_number',
    'invoice_date', 'due_date', 'notes', 'currency', 'subtotal', 'tax_total', 'total', 'created_by',
])]
class GoodsReceipt extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'invoice_date' => 'date',
            'due_date' => 'date',
            'subtotal' => 'decimal:2',
            'tax_total' => 'decimal:2',
            'total' => 'decimal:2',
        ];
    }

    /**
     * @return HasMany<GoodsReceiptLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(GoodsReceiptLine::class);
    }
}
