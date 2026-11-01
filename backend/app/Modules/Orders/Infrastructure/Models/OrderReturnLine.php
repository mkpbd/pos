<?php

namespace App\Modules\Orders\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * One order line of a return (E10b): the requested quantity (fixed), the approved quantity
 * with its share of the line's amount, tax and cost, and the restock decision at receipt.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $return_id
 * @property string $order_line_id
 * @property string $requested_quantity
 * @property string $quantity
 * @property string $amount
 * @property string $tax_amount
 * @property string $cost_total
 * @property ?bool $restock
 * @property string $restocked_quantity
 * @property CarbonImmutable $created_at
 * @property-read OrderLine $orderLine
 */
#[Table(timestamps: false)]
#[Fillable([
    'organization_id', 'return_id', 'order_line_id', 'requested_quantity', 'quantity', 'amount', 'tax_amount',
    'cost_total', 'restock', 'restocked_quantity', 'created_at',
])]
class OrderReturnLine extends Model
{
    use BelongsToOrganization, HasUuids;

    /** What may change after the line was written. */
    private const MUTABLE = ['quantity', 'amount', 'tax_amount', 'cost_total', 'restock', 'restocked_quantity'];

    protected function casts(): array
    {
        return [
            'requested_quantity' => 'decimal:3',
            'quantity' => 'decimal:3',
            'amount' => 'decimal:2',
            'tax_amount' => 'decimal:2',
            'cost_total' => 'decimal:2',
            'restock' => 'boolean',
            'restocked_quantity' => 'decimal:3',
            'created_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(function (OrderReturnLine $line) {
            if (array_diff(array_keys($line->getDirty()), self::MUTABLE) !== []) {
                throw new LogicException('A return line keeps its order line and requested quantity.');
            }
        });
        static::deleting(fn () => throw new LogicException('Return lines cannot be deleted.'));
    }

    /**
     * @return BelongsTo<OrderLine, $this>
     */
    public function orderLine(): BelongsTo
    {
        return $this->belongsTo(OrderLine::class);
    }
}
