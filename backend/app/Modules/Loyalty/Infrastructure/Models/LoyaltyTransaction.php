<?php

namespace App\Modules\Loyalty\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use LogicException;

/**
 * One points movement. Append-only (mirrors the PostgreSQL trigger).
 *
 * @property string $id
 * @property string $customer_id
 * @property string $type
 * @property int $points
 * @property int $balance_after
 * @property ?string $value
 * @property ?string $sale_id
 * @property string $source_type
 * @property ?string $source_id
 * @property ?string $source_number
 * @property ?string $notes
 * @property ?string $created_by
 * @property Carbon $created_at
 */
#[Table(timestamps: false)]
#[Fillable([
    'organization_id', 'customer_id', 'type', 'points', 'balance_after', 'value', 'sale_id',
    'source_type', 'source_id', 'source_number', 'notes', 'created_by', 'created_at',
])]
class LoyaltyTransaction extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'points' => 'integer',
            'balance_after' => 'integer',
            'value' => 'decimal:2',
            'created_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Loyalty transactions are append-only.'));
        static::deleting(fn () => throw new LogicException('Loyalty transactions are append-only.'));
    }
}
