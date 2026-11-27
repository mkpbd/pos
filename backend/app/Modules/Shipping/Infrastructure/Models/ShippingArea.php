<?php

namespace App\Modules\Shipping\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * BD2a: a merchant-defined delivery area inside a district (thana / upazila) whose
 * `fee_adjustment` (may be negative) is added to every delivery method's fee there.
 *
 * @property string $id
 * @property string $organization_id
 * @property int $district_id
 * @property string $name
 * @property string $fee_adjustment
 * @property bool $is_active
 * @property int $sort_order
 */
#[Fillable(['organization_id', 'district_id', 'name', 'fee_adjustment', 'is_active', 'sort_order'])]
class ShippingArea extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    protected $attributes = [
        'fee_adjustment' => '0.00',
        'is_active' => true,
        'sort_order' => 0,
    ];

    protected function casts(): array
    {
        return [
            'district_id' => 'integer',
            'fee_adjustment' => 'decimal:2',
            'is_active' => 'boolean',
            'sort_order' => 'integer',
        ];
    }
}
