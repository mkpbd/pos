<?php

namespace App\Modules\Sales\Infrastructure\Models;

use App\Modules\Sales\Domain\SaleStatus;
use App\Modules\Sales\Domain\TaxMode;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;
use LogicException;

/**
 * A posted sale invoice. Immutable once written; cancelling it is the only change allowed.
 *
 * @property string $id
 * @property string $branch_id
 * @property string $store_id
 * @property string $number
 * @property ?string $customer_id
 * @property SaleStatus $status
 * @property TaxMode $tax_mode
 * @property string $currency
 * @property string $subtotal
 * @property string $item_discount_total
 * @property ?string $invoice_discount_type
 * @property ?string $invoice_discount_value
 * @property ?string $invoice_discount_source
 * @property string $invoice_discount_total
 * @property string $tax_total
 * @property string $total
 * @property string $paid_total
 * @property string $change_total
 * @property string $due_total
 * @property string $cost_total
 * @property ?string $notes
 * @property Carbon $sold_at
 * @property ?string $created_by
 * @property ?Carbon $cancelled_at
 * @property ?string $cancelled_by
 * @property ?string $cancellation_reason
 * @property Carbon $created_at
 */
#[Fillable([
    'id', 'organization_id', 'branch_id', 'store_id', 'number', 'customer_id', 'status', 'tax_mode', 'currency',
    'subtotal', 'item_discount_total', 'invoice_discount_type', 'invoice_discount_value', 'invoice_discount_source',
    'invoice_discount_total', 'tax_total', 'total', 'paid_total', 'change_total', 'due_total', 'cost_total',
    'notes', 'sold_at', 'created_by', 'cancelled_at', 'cancelled_by', 'cancellation_reason',
])]
class Sale extends Model
{
    use BelongsToOrganization, HasUuids;

    /** Columns a posted sale may still change: its cancellation. */
    private const MUTABLE = ['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at'];

    protected function casts(): array
    {
        return [
            'status' => SaleStatus::class,
            'tax_mode' => TaxMode::class,
            'subtotal' => 'decimal:2',
            'item_discount_total' => 'decimal:2',
            'invoice_discount_value' => 'decimal:2',
            'invoice_discount_total' => 'decimal:2',
            'tax_total' => 'decimal:2',
            'total' => 'decimal:2',
            'paid_total' => 'decimal:2',
            'change_total' => 'decimal:2',
            'due_total' => 'decimal:2',
            'cost_total' => 'decimal:2',
            'sold_at' => 'datetime',
            'cancelled_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(function (Sale $sale) {
            if (array_diff(array_keys($sale->getDirty()), self::MUTABLE) !== []) {
                throw new LogicException('Posted sales are immutable; only their cancellation can be recorded.');
            }
        });
        static::deleting(fn () => throw new LogicException('Posted sales cannot be deleted.'));
    }

    /**
     * @return HasMany<SaleLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(SaleLine::class)->orderBy('position');
    }

    /**
     * @return HasMany<SalePayment, $this>
     */
    public function payments(): HasMany
    {
        return $this->hasMany(SalePayment::class)->orderBy('created_at');
    }
}
