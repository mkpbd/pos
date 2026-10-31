<?php

namespace App\Modules\Orders\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * Snapshot of an order's delivery address (names of division/district included).
 *
 * @property string $id
 * @property string $order_id
 * @property string $kind
 * @property string $recipient_name
 * @property string $phone
 * @property ?string $email
 * @property int $division_id
 * @property string $division_name
 * @property int $district_id
 * @property string $district_name
 * @property ?string $area
 * @property string $address_line
 * @property ?string $postcode
 * @property CarbonImmutable $created_at
 */
#[Table(timestamps: false)]
#[Fillable([
    'organization_id', 'order_id', 'kind', 'recipient_name', 'phone', 'email', 'division_id', 'division_name',
    'district_id', 'district_name', 'area', 'address_line', 'postcode', 'created_at',
])]
class OrderAddress extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return ['division_id' => 'integer', 'district_id' => 'integer', 'created_at' => 'immutable_datetime'];
    }
}
