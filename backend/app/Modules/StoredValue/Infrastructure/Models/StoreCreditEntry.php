<?php

namespace App\Modules\StoredValue\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use LogicException;

/**
 * One movement of a customer's store credit. Append-only (mirrors the PostgreSQL trigger).
 *
 * @property string $id
 * @property string $organization_id
 * @property string $customer_id
 * @property string $type
 * @property string $amount
 * @property string $balance_after
 * @property string $currency
 * @property ?string $method
 * @property ?string $reference
 * @property ?string $reference_type
 * @property ?string $reference_id
 * @property ?string $reference_number
 * @property ?string $receipt_number
 * @property ?string $note
 * @property ?string $store_id
 * @property ?string $created_by
 * @property Carbon $created_at
 */
#[Table(timestamps: false)]
#[Fillable([
    'id', 'organization_id', 'customer_id', 'type', 'amount', 'balance_after', 'currency', 'method', 'reference',
    'reference_type', 'reference_id', 'reference_number', 'receipt_number', 'note', 'store_id', 'created_by', 'created_at',
])]
class StoreCreditEntry extends Model
{
    use BelongsToOrganization, HasUuids;

    public const TYPES = ['top_up', 'withdrawal', 'sale_payment', 'sale_reversal', 'refund', 'adjustment'];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'balance_after' => 'decimal:2',
            'created_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Store credit entries are append-only.'));
        static::deleting(fn () => throw new LogicException('Store credit entries are append-only.'));
    }
}
