<?php

namespace App\Modules\Orders\Infrastructure\Models;

use App\Modules\Orders\Domain\ShipmentStatus;
use App\Modules\Sales\Infrastructure\Models\AppendOnly;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * One tracking step of a shipment. Append-only.
 *
 * @property string $id
 * @property string $shipment_id
 * @property ShipmentStatus $status
 * @property ?string $note
 * @property CarbonImmutable $occurred_at
 * @property ?string $created_by
 * @property CarbonImmutable $created_at
 */
#[Table('shipment_events', timestamps: false)]
#[Fillable(['organization_id', 'shipment_id', 'status', 'note', 'occurred_at', 'created_by', 'created_at'])]
class ShipmentEvent extends Model
{
    use AppendOnly, BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'status' => ShipmentStatus::class,
            'occurred_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
        ];
    }
}
