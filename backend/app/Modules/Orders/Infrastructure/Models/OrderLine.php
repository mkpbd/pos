<?php

namespace App\Modules\Orders\Infrastructure\Models;

use App\Modules\Sales\Infrastructure\Models\AppendOnly;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One order line: snapshot product data and server-computed amounts. Append-only.
 *
 * @property string $id
 * @property string $order_id
 * @property int $position
 * @property string $product_id
 * @property string $variant_id
 * @property string $product_name
 * @property ?string $variant_name
 * @property ?string $product_slug
 * @property string $sku
 * @property ?array<string, string> $option_values
 * @property ?string $image_url
 * @property string $quantity
 * @property string $unit_price
 * @property ?string $compare_at_price
 * @property string $line_subtotal
 * @property string $net_amount
 * @property string $tax_rate
 * @property string $tax_amount
 * @property string $line_total
 * @property string $unit_cost
 * @property string $cost_total
 * @property CarbonImmutable $created_at
 */
#[Table(timestamps: false)]
#[Fillable([
    'organization_id', 'order_id', 'position', 'product_id', 'variant_id', 'product_name', 'variant_name', 'product_slug',
    'sku', 'option_values', 'image_url', 'quantity', 'unit_price', 'compare_at_price', 'line_subtotal', 'net_amount',
    'tax_rate', 'tax_amount', 'line_total', 'unit_cost', 'cost_total', 'created_at',
])]
class OrderLine extends Model
{
    use AppendOnly, BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'position' => 'integer',
            'option_values' => 'array',
            'quantity' => 'decimal:3',
            'unit_price' => 'decimal:2',
            'compare_at_price' => 'decimal:2',
            'line_subtotal' => 'decimal:2',
            'net_amount' => 'decimal:2',
            'tax_rate' => 'decimal:4',
            'tax_amount' => 'decimal:2',
            'line_total' => 'decimal:2',
            'unit_cost' => 'decimal:4',
            'cost_total' => 'decimal:2',
            'created_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return HasMany<OrderLineStock, $this>
     */
    public function stock(): HasMany
    {
        return $this->hasMany(OrderLineStock::class);
    }
}
