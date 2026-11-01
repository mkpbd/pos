<?php

namespace App\Modules\Orders\Infrastructure\Models;

use App\Modules\Orders\Domain\RefundMethod;
use App\Modules\Orders\Domain\ReturnReason;
use App\Modules\Orders\Domain\ReturnStatus;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * An online return of goods of a web order (E10b). The header records the workflow; the
 * refund is the sum of the lines plus the shipping refund granted at approval.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $order_id
 * @property string $number
 * @property ReturnStatus $status
 * @property ReturnReason $reason_code
 * @property ?string $customer_note
 * @property ?string $staff_note
 * @property ?string $rejection_reason
 * @property string $requested_by customer | staff
 * @property bool $override_window
 * @property string $currency
 * @property string $items_amount
 * @property string $shipping_refund
 * @property string $refund_amount
 * @property ?RefundMethod $refund_method
 * @property ?string $refund_reference
 * @property ?string $requested_by_user_id
 * @property ?CarbonImmutable $approved_at
 * @property ?string $approved_by
 * @property ?CarbonImmutable $rejected_at
 * @property ?string $rejected_by
 * @property ?CarbonImmutable $received_at
 * @property ?string $received_by
 * @property ?CarbonImmutable $refunded_at
 * @property ?string $refunded_by
 * @property ?CarbonImmutable $cancelled_at
 * @property CarbonImmutable $created_at
 * @property CarbonImmutable $updated_at
 * @property-read Order $order
 */
#[Fillable([
    'organization_id', 'order_id', 'number', 'status', 'reason_code', 'customer_note', 'staff_note', 'rejection_reason',
    'requested_by', 'override_window', 'currency', 'items_amount', 'shipping_refund', 'refund_amount', 'refund_method',
    'refund_reference', 'requested_by_user_id', 'approved_at', 'approved_by', 'rejected_at', 'rejected_by', 'received_at',
    'received_by', 'refunded_at', 'refunded_by', 'cancelled_at',
])]
class OrderReturn extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'status' => ReturnStatus::class,
            'reason_code' => ReturnReason::class,
            'refund_method' => RefundMethod::class,
            'override_window' => 'boolean',
            'items_amount' => 'decimal:2',
            'shipping_refund' => 'decimal:2',
            'refund_amount' => 'decimal:2',
            'approved_at' => 'immutable_datetime',
            'rejected_at' => 'immutable_datetime',
            'received_at' => 'immutable_datetime',
            'refunded_at' => 'immutable_datetime',
            'cancelled_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::deleting(fn () => throw new LogicException('Returns cannot be deleted.'));
    }

    /**
     * @return BelongsTo<Order, $this>
     */
    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    /**
     * @return HasMany<OrderReturnLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(OrderReturnLine::class, 'return_id');
    }

    /**
     * @return HasMany<OrderReturnHistory, $this>
     */
    public function history(): HasMany
    {
        return $this->hasMany(OrderReturnHistory::class, 'return_id')->orderBy('created_at')->orderBy('id');
    }
}
