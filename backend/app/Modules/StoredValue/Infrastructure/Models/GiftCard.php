<?php

namespace App\Modules\StoredValue\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\StoredValue\Domain\GiftCardKind;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * POS1b: a gift card, voucher or credit note. The code is stored only as a hash; the balance
 * changes only under a row lock, each change written to GiftCardEntry.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $code_hash
 * @property string $code_last4
 * @property GiftCardKind $kind
 * @property string $initial_value
 * @property string $balance
 * @property string $currency
 * @property string $status active|void
 * @property ?Carbon $expires_at
 * @property ?string $customer_id
 * @property ?string $issued_by
 * @property Carbon $issued_at
 * @property ?string $sale_receipt_number
 * @property ?string $source_return_id
 * @property ?string $note
 * @property ?string $void_reason
 * @property ?string $voided_by
 * @property ?Carbon $voided_at
 */
#[Fillable([
    'organization_id', 'code_hash', 'code_last4', 'kind', 'initial_value', 'balance', 'currency', 'status',
    'expires_at', 'customer_id', 'issued_by', 'issued_at', 'sale_receipt_number', 'source_return_id', 'note',
])]
#[Hidden(['code_hash'])]
class GiftCard extends Model
{
    use BelongsToOrganization, HasUuids;

    public const ACTIVE = 'active';

    public const VOID = 'void';

    protected function casts(): array
    {
        return [
            'kind' => GiftCardKind::class,
            'initial_value' => 'decimal:2',
            'balance' => 'decimal:2',
            'expires_at' => 'datetime',
            'issued_at' => 'datetime',
            'voided_at' => 'datetime',
        ];
    }

    public function isExpired(): bool
    {
        return $this->expires_at !== null && $this->expires_at->isPast();
    }

    /**
     * Why the card cannot be spent now, or null when it can.
     *
     * @return 'void'|'expired'|null
     */
    public function unusableReason(): ?string
    {
        return match (true) {
            $this->status === self::VOID => 'void',
            $this->isExpired() => 'expired',
            default => null,
        };
    }
}
