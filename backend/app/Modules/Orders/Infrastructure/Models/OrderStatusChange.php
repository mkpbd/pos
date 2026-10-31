<?php

namespace App\Modules\Orders\Infrastructure\Models;

use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Sales\Infrastructure\Models\AppendOnly;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * One step of an order's status history. Append-only; actor NULL = shopper or system.
 *
 * @property string $id
 * @property string $order_id
 * @property ?OrderStatus $from_status
 * @property OrderStatus $to_status
 * @property ?string $note
 * @property ?string $actor_user_id
 * @property CarbonImmutable $created_at
 */
#[Table('order_status_history', timestamps: false)]
#[Fillable(['organization_id', 'order_id', 'from_status', 'to_status', 'note', 'actor_user_id', 'created_at'])]
class OrderStatusChange extends Model
{
    use AppendOnly, BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'from_status' => OrderStatus::class,
            'to_status' => OrderStatus::class,
            'created_at' => 'immutable_datetime',
        ];
    }
}
