<?php

namespace App\Modules\Purchasing\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * A supplier catalog row (SC1): what the supplier sells us and on which terms.
 *
 * @property string $id
 * @property string $supplier_id
 * @property string $variant_id
 * @property ?string $supplier_sku
 * @property string $unit_cost
 * @property string $pack_size
 * @property ?string $min_order_qty
 * @property int $lead_time_days
 * @property bool $is_preferred
 * @property ?string $last_purchase_cost
 * @property ?Carbon $last_purchased_at
 * @property bool $is_active
 * @property ?Carbon $created_at
 * @property ?Carbon $updated_at
 */
#[Fillable([
    'organization_id', 'supplier_id', 'variant_id', 'supplier_sku', 'unit_cost', 'pack_size', 'min_order_qty',
    'lead_time_days', 'is_preferred', 'is_active',
])]
class SupplierProduct extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    public const DEFAULT_LEAD_TIME_DAYS = 7;

    protected $attributes = [
        'pack_size' => '1',
        'lead_time_days' => self::DEFAULT_LEAD_TIME_DAYS,
        'is_preferred' => false,
        'is_active' => true,
    ];

    protected function casts(): array
    {
        return [
            'unit_cost' => 'decimal:4',
            'pack_size' => 'decimal:3',
            'min_order_qty' => 'decimal:3',
            'lead_time_days' => 'integer',
            'is_preferred' => 'boolean',
            'last_purchase_cost' => 'decimal:4',
            'last_purchased_at' => 'datetime',
            'is_active' => 'boolean',
        ];
    }
}
