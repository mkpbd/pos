<?php

namespace App\Modules\Orders\Infrastructure\Models;

use App\Modules\Orders\Domain\RemittanceMethod;
use App\Modules\Sales\Infrastructure\Models\AppendOnly;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A courier's cash-on-delivery remittance (E10a). Append-only: never edited or deleted.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $number
 * @property string $courier_id
 * @property ?string $reference
 * @property CarbonImmutable $received_at
 * @property RemittanceMethod $method
 * @property string $currency
 * @property string $gross_amount
 * @property string $fee_amount
 * @property string $net_amount
 * @property ?string $expense_id
 * @property ?string $expense_number
 * @property ?string $note
 * @property ?string $created_by
 * @property CarbonImmutable $created_at
 * @property-read Collection<int, CodRemittanceLine> $lines
 */
#[Table('cod_remittances', timestamps: false)]
#[Fillable([
    'organization_id', 'number', 'courier_id', 'reference', 'received_at', 'method', 'currency', 'gross_amount',
    'fee_amount', 'net_amount', 'expense_id', 'expense_number', 'note', 'created_by', 'created_at',
])]
class CodRemittance extends Model
{
    use AppendOnly, BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'received_at' => 'immutable_date',
            'method' => RemittanceMethod::class,
            'gross_amount' => 'decimal:2',
            'fee_amount' => 'decimal:2',
            'net_amount' => 'decimal:2',
            'created_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return HasMany<CodRemittanceLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(CodRemittanceLine::class, 'remittance_id');
    }
}
