<?php

namespace App\Modules\Payments\Infrastructure\Models;

use App\Modules\Payments\Domain\PaymentDirection;
use App\Modules\Payments\Domain\PaymentMethod;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use LogicException;

/**
 * One row of the payments ledger. Append-only (mirrors the PostgreSQL trigger).
 *
 * @property string $id
 * @property string $branch_id
 * @property ?string $cash_register_session_id
 * @property PaymentDirection $direction
 * @property PaymentMethod $method
 * @property string $currency
 * @property string $amount
 * @property string $source_type
 * @property ?string $source_id
 * @property ?string $source_number
 * @property ?string $customer_id
 * @property ?string $reference
 * @property ?string $description
 * @property ?string $created_by
 * @property Carbon $created_at
 */
#[Table(timestamps: false)]
#[Fillable([
    'organization_id', 'branch_id', 'cash_register_session_id', 'direction', 'method', 'currency', 'amount',
    'source_type', 'source_id', 'source_number', 'customer_id', 'reference', 'description', 'created_by', 'created_at',
])]
class Payment extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'direction' => PaymentDirection::class,
            'method' => PaymentMethod::class,
            'amount' => 'decimal:2',
            'created_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Payments are append-only.'));
        static::deleting(fn () => throw new LogicException('Payments are append-only.'));
    }
}
