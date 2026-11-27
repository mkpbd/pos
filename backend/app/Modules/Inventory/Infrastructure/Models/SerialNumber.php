<?php

namespace App\Modules\Inventory\Infrastructure\Models;

use App\Modules\Inventory\Domain\SerialStatus;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * ST2d: one serial-numbered unit (written only through SerialRegister).
 *
 * @property string $id
 * @property string $organization_id
 * @property string $variant_id
 * @property string $serial
 * @property ?string $store_id
 * @property SerialStatus $status
 * @property ?Carbon $updated_at
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'variant_id', 'serial', 'store_id', 'status', 'updated_at'])]
class SerialNumber extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'status' => SerialStatus::class,
            'updated_at' => 'datetime',
        ];
    }

    /**
     * @return HasMany<SerialNumberEvent, $this>
     */
    public function events(): HasMany
    {
        return $this->hasMany(SerialNumberEvent::class);
    }
}
