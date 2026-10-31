<?php

namespace App\Modules\Sales\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * One invoice line with snapshot product data and server-computed amounts. Append-only.
 *
 * @property string $id
 * @property string $sale_id
 * @property int $position
 * @property string $variant_id
 * @property string $product_name
 * @property ?string $variant_name
 * @property string $sku
 * @property ?string $unit_code
 * @property string $quantity
 * @property string $unit_price
 * @property ?string $discount_type
 * @property ?string $discount_value
 * @property string $line_subtotal
 * @property string $discount_amount
 * @property string $invoice_discount_share
 * @property string $net_amount
 * @property string $tax_rate
 * @property string $tax_amount
 * @property string $line_total
 * @property string $unit_cost
 * @property string $cost_total
 * @property Carbon $created_at
 */
#[Table(timestamps: false)]
#[Fillable([
    'organization_id', 'sale_id', 'position', 'variant_id', 'product_name', 'variant_name', 'sku', 'unit_code',
    'quantity', 'unit_price', 'discount_type', 'discount_value', 'line_subtotal', 'discount_amount',
    'invoice_discount_share', 'net_amount', 'tax_rate', 'tax_amount', 'line_total', 'unit_cost', 'cost_total', 'created_at',
])]
class SaleLine extends Model
{
    use AppendOnly, BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'quantity' => 'decimal:3',
            'unit_price' => 'decimal:2',
            'discount_value' => 'decimal:2',
            'line_subtotal' => 'decimal:2',
            'discount_amount' => 'decimal:2',
            'invoice_discount_share' => 'decimal:2',
            'net_amount' => 'decimal:2',
            'tax_rate' => 'decimal:4',
            'tax_amount' => 'decimal:2',
            'line_total' => 'decimal:2',
            'unit_cost' => 'decimal:4',
            'cost_total' => 'decimal:2',
            'created_at' => 'datetime',
        ];
    }

    /**
     * @return HasMany<SaleLineStock, $this>
     */
    public function stock(): HasMany
    {
        return $this->hasMany(SaleLineStock::class);
    }

    /**
     * @return HasMany<SaleLineSerial, $this>
     */
    public function serials(): HasMany
    {
        return $this->hasMany(SaleLineSerial::class);
    }
}
