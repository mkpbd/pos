<?php

namespace App\Modules\Shipping\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A delivery method of a zone: flat fee (free from `free_over`), cash-on-delivery rules and
 * delivery time in days.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $zone_id
 * @property string $name
 * @property ?string $description
 * @property string $fee
 * @property ?string $free_over
 * @property bool $cod_allowed
 * @property string $cod_fee
 * @property int $eta_min_days
 * @property int $eta_max_days
 * @property bool $is_active
 * @property int $sort_order
 * @property-read ShippingZone $zone
 * @property ?array<string, array<string, string>> $translations {"bn": {field: text}} (E12b)
 */
#[Fillable([
    'organization_id', 'zone_id', 'name', 'description', 'fee', 'free_over', 'cod_allowed', 'cod_fee',
    'eta_min_days', 'eta_max_days', 'is_active', 'sort_order', 'translations',
])]
class ShippingMethod extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    protected $attributes = [
        'is_active' => true,
        'sort_order' => 0,
        'cod_allowed' => true,
        'cod_fee' => '0.00',
    ];

    protected function casts(): array
    {
        return [
            'fee' => 'decimal:2',
            'free_over' => 'decimal:2',
            'cod_allowed' => 'boolean',
            'cod_fee' => 'decimal:2',
            'eta_min_days' => 'integer',
            'eta_max_days' => 'integer',
            'is_active' => 'boolean',
            'sort_order' => 'integer',
            'translations' => 'array',
        ];
    }

    /**
     * @return BelongsTo<ShippingZone, $this>
     */
    public function zone(): BelongsTo
    {
        return $this->belongsTo(ShippingZone::class, 'zone_id');
    }
}
