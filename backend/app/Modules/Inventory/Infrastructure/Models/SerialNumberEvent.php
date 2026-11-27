<?php

namespace App\Modules\Inventory\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use LogicException;

/**
 * ST2d: append-only history of a serial number (also enforced by a PostgreSQL trigger).
 *
 * @property string $id
 * @property string $serial_number_id
 * @property string $type received|transferred_out|transferred_in|sold|returned|returned_to_supplier|adjusted_in|written_off
 * @property ?string $store_id
 * @property string $reference_type
 * @property string $reference_id
 * @property ?string $reference_number
 * @property ?string $created_by
 * @property Carbon $created_at
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'serial_number_id', 'type', 'store_id', 'reference_type', 'reference_id', 'reference_number', 'created_by', 'created_at'])]
class SerialNumberEvent extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Serial number events are immutable.'));
        static::deleting(fn () => throw new LogicException('Serial number events are immutable.'));
    }
}
