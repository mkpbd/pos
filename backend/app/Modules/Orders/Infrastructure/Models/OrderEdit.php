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
 * BD1b: one edit of an order's contents — what it was before and after (lines, totals,
 * contact, address, delivery method, coupon, notes). Append-only.
 *
 * @property string $id
 * @property string $order_id
 * @property int $revision the order's revision after this edit
 * @property ?string $reason
 * @property array<string, mixed> $before
 * @property array<string, mixed> $after
 * @property ?string $actor_user_id
 * @property CarbonImmutable $created_at
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'order_id', 'revision', 'reason', 'before', 'after', 'actor_user_id', 'created_at'])]
class OrderEdit extends Model
{
    use AppendOnly, BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'revision' => 'integer',
            'before' => 'array',
            'after' => 'array',
            'created_at' => 'immutable_datetime',
        ];
    }
}
