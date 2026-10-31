<?php

namespace App\Modules\Customers\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * @property string $id
 * @property string $organization_id
 * @property string $customer_id
 * @property ?string $label
 * @property string $recipient_name
 * @property string $phone
 * @property int $division_id
 * @property int $district_id
 * @property string $area
 * @property string $address_line
 * @property ?string $postcode
 * @property bool $is_default_shipping
 * @property bool $is_default_billing
 * @property ?CarbonImmutable $created_at
 */
#[Fillable([
    'organization_id', 'customer_id', 'label', 'recipient_name', 'phone', 'division_id', 'district_id',
    'area', 'address_line', 'postcode', 'is_default_shipping', 'is_default_billing',
])]
class CustomerAddress extends Model
{
    use BelongsToOrganization, HasUuids, SoftDeletes;

    protected $attributes = [
        'is_default_shipping' => false,
        'is_default_billing' => false,
    ];

    protected function casts(): array
    {
        return [
            'division_id' => 'integer',
            'district_id' => 'integer',
            'is_default_shipping' => 'boolean',
            'is_default_billing' => 'boolean',
            'created_at' => 'immutable_datetime',
        ];
    }
}
