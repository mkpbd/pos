<?php

namespace App\Modules\StoredValue\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\StoredValue\Domain\GiftCardEntryType;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use LogicException;

/**
 * POS1b: one movement of a gift card's balance. Append-only (mirrors the PostgreSQL trigger).
 *
 * @property string $id
 * @property string $gift_card_id
 * @property GiftCardEntryType $type
 * @property string $amount signed
 * @property string $balance_after
 * @property ?string $reference_type
 * @property ?string $reference_id
 * @property ?string $reference_number
 * @property ?string $created_by
 * @property Carbon $created_at
 */
#[Table(timestamps: false)]
#[Fillable([
    'organization_id', 'gift_card_id', 'type', 'amount', 'balance_after',
    'reference_type', 'reference_id', 'reference_number', 'created_by', 'created_at',
])]
class GiftCardEntry extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'type' => GiftCardEntryType::class,
            'amount' => 'decimal:2',
            'balance_after' => 'decimal:2',
            'created_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Gift card entries are append-only.'));
        static::deleting(fn () => throw new LogicException('Gift card entries are append-only.'));
    }
}
