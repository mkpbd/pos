<?php

namespace App\Modules\Sales\Infrastructure\Models;

use App\Modules\Sales\Domain\ReturnStatus;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;
use LogicException;

/**
 * Goods coming back against a sale invoice. Written as a pending request; the decision
 * (completion with its credit/refund split, or rejection) is the only change it ever sees.
 *
 * @property string $id
 * @property string $branch_id
 * @property string $store_id
 * @property string $sale_id
 * @property ?string $customer_id
 * @property string $number
 * @property ReturnStatus $status
 * @property ?string $return_reason_id
 * @property ?string $notes
 * @property string $currency
 * @property string $subtotal
 * @property string $tax_total
 * @property string $total
 * @property string $credited_total
 * @property string $refunded_total
 * @property ?string $requested_by
 * @property Carbon $requested_at
 * @property ?string $decided_by
 * @property ?Carbon $decided_at
 * @property ?string $rejection_reason
 */
#[Fillable([
    'id', 'organization_id', 'branch_id', 'store_id', 'sale_id', 'customer_id', 'number', 'status', 'return_reason_id', 'notes',
    'currency', 'subtotal', 'tax_total', 'total', 'credited_total', 'refunded_total',
    'requested_by', 'requested_at', 'decided_by', 'decided_at', 'rejection_reason',
])]
class SaleReturn extends Model
{
    use BelongsToOrganization, HasUuids;

    /** Columns that change when a pending return is decided. */
    private const DECISION = ['status', 'credited_total', 'refunded_total', 'decided_by', 'decided_at', 'rejection_reason', 'updated_at'];

    protected $attributes = [
        'credited_total' => '0',
        'refunded_total' => '0',
    ];

    protected function casts(): array
    {
        return [
            'status' => ReturnStatus::class,
            'subtotal' => 'decimal:2',
            'tax_total' => 'decimal:2',
            'total' => 'decimal:2',
            'credited_total' => 'decimal:2',
            'refunded_total' => 'decimal:2',
            'requested_at' => 'datetime',
            'decided_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(function (SaleReturn $return) {
            if ($return->getOriginal('status') !== ReturnStatus::Pending || array_diff(array_keys($return->getDirty()), self::DECISION) !== []) {
                throw new LogicException('Sale returns are immutable once decided; only the decision of a pending return can be recorded.');
            }
        });
        static::deleting(fn () => throw new LogicException('Sale returns cannot be deleted.'));
    }

    /**
     * @return HasMany<SaleReturnLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(SaleReturnLine::class);
    }

    /**
     * @return HasMany<SaleReturnRefund, $this>
     */
    public function refunds(): HasMany
    {
        return $this->hasMany(SaleReturnRefund::class)->orderBy('created_at');
    }

    /**
     * @return BelongsTo<Sale, $this>
     */
    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }

    /**
     * @return BelongsTo<ReturnReason, $this>
     */
    public function reason(): BelongsTo
    {
        return $this->belongsTo(ReturnReason::class, 'return_reason_id');
    }
}
