<?php

namespace App\Modules\Sales\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * Quantity of one invoice line coming back, valued at its share of what was charged. Append-only.
 *
 * @property string $id
 * @property string $sale_return_id
 * @property string $sale_line_id
 * @property string $variant_id
 * @property string $quantity
 * @property bool $restock
 * @property string $net_amount
 * @property string $tax_amount
 * @property string $line_total
 * @property string $unit_cost
 * @property string $cost_total
 * @property ?list<string> $serials
 * @property Carbon $created_at
 */
#[Table(timestamps: false)]
#[Fillable([
    'organization_id', 'sale_return_id', 'sale_line_id', 'variant_id', 'quantity', 'restock',
    'net_amount', 'tax_amount', 'line_total', 'unit_cost', 'cost_total', 'serials', 'created_at',
])]
class SaleReturnLine extends Model
{
    use AppendOnly, BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'quantity' => 'decimal:3',
            'restock' => 'boolean',
            'net_amount' => 'decimal:2',
            'tax_amount' => 'decimal:2',
            'line_total' => 'decimal:2',
            'unit_cost' => 'decimal:4',
            'cost_total' => 'decimal:2',
            'serials' => 'array',
            'created_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<SaleLine, $this>
     */
    public function saleLine(): BelongsTo
    {
        return $this->belongsTo(SaleLine::class);
    }

    /**
     * @return HasMany<SaleReturnLineStock, $this>
     */
    public function stock(): HasMany
    {
        return $this->hasMany(SaleReturnLineStock::class);
    }
}
