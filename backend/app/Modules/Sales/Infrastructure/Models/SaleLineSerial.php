<?php

namespace App\Modules\Sales\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * A serial number sold on a line; released again when the sale is cancelled.
 *
 * @property string $id
 * @property string $sale_line_id
 * @property string $variant_id
 * @property string $serial
 * @property ?Carbon $released_at
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'sale_line_id', 'variant_id', 'serial', 'released_at'])]
class SaleLineSerial extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return ['released_at' => 'datetime'];
    }
}
