<?php

namespace App\Modules\Orders\Infrastructure\Models;

use App\Modules\Orders\Domain\OrderPaymentMethod;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Domain\PaymentStatus;
use App\Modules\Sales\Domain\TaxMode;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use LogicException;

/**
 * A web order. Amounts and lines never change after placement; the header records the
 * workflow (status, payment, shipping details, cancellation).
 *
 * @property string $id
 * @property string $organization_id
 * @property string $number
 * @property ?string $customer_id
 * @property ?string $customer_account_id
 * @property string $branch_id
 * @property string $store_id
 * @property OrderStatus $status
 * @property PaymentStatus $payment_status
 * @property OrderPaymentMethod $payment_method
 * @property ?string $shipping_method_id
 * @property string $shipping_method_name
 * @property ?int $eta_min_days
 * @property ?int $eta_max_days
 * @property string $currency
 * @property TaxMode $tax_mode
 * @property string $subtotal
 * @property string $tax_total
 * @property string $shipping_total
 * @property string $cod_fee
 * @property string $total
 * @property string $paid_total
 * @property string $cost_total
 * @property string $contact_name
 * @property string $contact_email
 * @property string $contact_phone
 * @property ?string $notes
 * @property ?string $access_token_hash
 * @property ?string $courier_name
 * @property ?string $tracking_number
 * @property CarbonImmutable $placed_at
 * @property ?CarbonImmutable $expires_at
 * @property ?CarbonImmutable $confirmed_at
 * @property ?CarbonImmutable $shipped_at
 * @property ?CarbonImmutable $delivered_at
 * @property ?CarbonImmutable $cancelled_at
 * @property ?string $cancelled_by
 * @property ?string $cancel_reason
 * @property ?string $ip
 * @property ?string $user_agent
 */
#[Fillable([
    'id', 'organization_id', 'number', 'customer_id', 'customer_account_id', 'branch_id', 'store_id', 'status',
    'payment_status', 'payment_method', 'shipping_method_id', 'shipping_method_name', 'eta_min_days', 'eta_max_days',
    'currency', 'tax_mode', 'subtotal', 'tax_total', 'shipping_total', 'cod_fee', 'total', 'paid_total', 'cost_total',
    'contact_name', 'contact_email', 'contact_phone', 'notes', 'access_token_hash', 'courier_name', 'tracking_number',
    'placed_at', 'expires_at', 'confirmed_at', 'shipped_at', 'delivered_at', 'cancelled_at', 'cancelled_by',
    'cancel_reason', 'ip', 'user_agent',
])]
class Order extends Model
{
    use BelongsToOrganization, HasUuids;

    /** What the workflow may change after placement. */
    private const MUTABLE = [
        'status', 'payment_status', 'paid_total', 'shipping_method_id', 'courier_name', 'tracking_number', 'expires_at',
        'confirmed_at', 'shipped_at', 'delivered_at', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'updated_at',
    ];

    protected function casts(): array
    {
        return [
            'status' => OrderStatus::class,
            'payment_status' => PaymentStatus::class,
            'payment_method' => OrderPaymentMethod::class,
            'tax_mode' => TaxMode::class,
            'eta_min_days' => 'integer',
            'eta_max_days' => 'integer',
            'subtotal' => 'decimal:2',
            'tax_total' => 'decimal:2',
            'shipping_total' => 'decimal:2',
            'cod_fee' => 'decimal:2',
            'total' => 'decimal:2',
            'paid_total' => 'decimal:2',
            'cost_total' => 'decimal:2',
            'placed_at' => 'immutable_datetime',
            'expires_at' => 'immutable_datetime',
            'confirmed_at' => 'immutable_datetime',
            'shipped_at' => 'immutable_datetime',
            'delivered_at' => 'immutable_datetime',
            'cancelled_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(function (Order $order) {
            if (array_diff(array_keys($order->getDirty()), self::MUTABLE) !== []) {
                throw new LogicException('Placed orders keep their contents; only the workflow columns change.');
            }
        });
        static::deleting(fn () => throw new LogicException('Orders cannot be deleted.'));
    }

    /**
     * @return HasMany<OrderLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(OrderLine::class)->orderBy('position');
    }

    /**
     * @return HasOne<OrderAddress, $this>
     */
    public function shippingAddress(): HasOne
    {
        return $this->hasOne(OrderAddress::class)->where('kind', 'shipping');
    }

    /**
     * @return HasMany<OrderStatusChange, $this>
     */
    public function history(): HasMany
    {
        return $this->hasMany(OrderStatusChange::class)->orderBy('created_at')->orderBy('id');
    }
}
