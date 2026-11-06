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
 * @property string $charges_total SC3: Σ charge amounts (capitalised)
 * @property string $charges_tax_total SC3: Σ charge tax (recoverable, not capitalised)
 * @property string $landed_total SC3: subtotal + charges_total
 * @property string $payable_total SC3: total + charges (with tax) billed on the main supplier's invoice
 * @property ?string $created_by
 * @property Carbon $created_at
 */
#[Fillable([
    'organization_id', 'number', 'supplier_id', 'branch_id', 'store_id', 'purchase_order_id', 'supplier_invoice_number',
    'invoice_date', 'due_date', 'notes', 'currency', 'subtotal', 'tax_total', 'total', 'charges_total', 'charges_tax_total',
    'landed_total', 'payable_total', 'created_by',
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
            'charges_total' => 'decimal:2',
            'charges_tax_total' => 'decimal:2',
            'landed_total' => 'decimal:2',
            'payable_total' => 'decimal:2',
        ];
    }

    /**
     * @return HasMany<GoodsReceiptCharge, $this>
     */
    public function charges(): HasMany
    {
        return $this->hasMany(GoodsReceiptCharge::class)->orderBy('sort_order');
    }

    /**
     * @return HasMany<GoodsReceiptLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(GoodsReceiptLine::class);
    }
}
