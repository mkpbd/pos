<?php

namespace App\Modules\Shipping\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $organization_id
 * @property string $zone_id
 * @property int $district_id
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'zone_id', 'district_id'])]
class ShippingZoneDistrict extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return ['district_id' => 'integer'];
    }
}
