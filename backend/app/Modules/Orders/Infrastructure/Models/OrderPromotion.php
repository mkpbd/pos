<?php

namespace App\Modules\Orders\Infrastructure\Models;

use App\Modules\Sales\Infrastructure\Models\AppendOnly;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * A promotion an order used, as it was named then (E8b). Append-only.
 *
 * @property string $id
 * @property string $order_id
 * @property ?string $promotion_id
 * @property string $name
 * @property string $kind product | order | shipping
 * @property string $amount
 * @property CarbonImmutable $created_at
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'order_id', 'promotion_id', 'name', 'kind', 'amount', 'created_at'])]
class OrderPromotion extends Model
{
    use AppendOnly, BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'created_at' => 'immutable_datetime',
        ];
    }
}
