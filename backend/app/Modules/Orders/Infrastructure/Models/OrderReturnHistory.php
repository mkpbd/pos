<?php

namespace App\Modules\Orders\Infrastructure\Models;

use App\Modules\Orders\Domain\ReturnStatus;
use App\Modules\Sales\Infrastructure\Models\AppendOnly;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * A status change of an online return (E10b). Append-only.
 *
 * @property string $id
 * @property string $return_id
 * @property ?ReturnStatus $from_status
 * @property ReturnStatus $to_status
 * @property ?string $note
 * @property ?string $actor_user_id
 * @property string $actor_type customer | staff
 * @property CarbonImmutable $created_at
 */
#[Table('order_return_history', timestamps: false)]
#[Fillable(['organization_id', 'return_id', 'from_status', 'to_status', 'note', 'actor_user_id', 'actor_type', 'created_at'])]
class OrderReturnHistory extends Model
{
    use AppendOnly, BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'from_status' => ReturnStatus::class,
            'to_status' => ReturnStatus::class,
            'created_at' => 'immutable_datetime',
        ];
    }
}
