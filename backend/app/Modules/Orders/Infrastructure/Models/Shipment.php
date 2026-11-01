<?php

namespace App\Modules\Orders\Infrastructure\Models;

use App\Modules\Orders\Domain\ShipmentStatus;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * The parcel of a web order handed to a courier (E10a). The courier name is a snapshot;
 * only the status and its timestamps change afterwards.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $order_id
 * @property ?string $courier_id
 * @property string $courier_name
 * @property ?string $tracking_number
 * @property ShipmentStatus $status
 * @property string $cod_amount
 * @property CarbonImmutable $shipped_at
 * @property ?CarbonImmutable $delivered_at
 * @property ?CarbonImmutable $returned_at
 * @property ?string $created_by
 * @property-read Collection<int, ShipmentEvent> $events
 */
#[Fillable([
    'organization_id', 'order_id', 'courier_id', 'courier_name', 'tracking_number', 'status', 'cod_amount',
    'shipped_at', 'delivered_at', 'returned_at', 'created_by',
])]
class Shipment extends Model
{
    use BelongsToOrganization, HasUuids;

    private const MUTABLE = ['status', 'delivered_at', 'returned_at', 'updated_at'];

    protected function casts(): array
    {
        return [
            'status' => ShipmentStatus::class,
            'cod_amount' => 'decimal:2',
            'shipped_at' => 'immutable_datetime',
            'delivered_at' => 'immutable_datetime',
            'returned_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(function (Shipment $shipment) {
            if (array_diff(array_keys($shipment->getDirty()), self::MUTABLE) !== []) {
                throw new LogicException('A shipment keeps its courier and amounts; only its status changes.');
            }
        });
        static::deleting(fn () => throw new LogicException('Shipments cannot be deleted.'));
    }

    /**
     * @return HasMany<ShipmentEvent, $this>
     */
    public function events(): HasMany
    {
        return $this->hasMany(ShipmentEvent::class)->orderBy('occurred_at')->orderBy('created_at')->orderBy('id');
    }
}
