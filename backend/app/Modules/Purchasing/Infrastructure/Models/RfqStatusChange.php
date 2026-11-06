<?php

namespace App\Modules\Purchasing\Infrastructure\Models;

use App\Modules\Sales\Infrastructure\Models\AppendOnly;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * One step of an RFQ's status history (SC2; append-only).
 *
 * @property string $id
 * @property string $rfq_id
 * @property ?string $from_status
 * @property string $to_status
 * @property ?string $note
 * @property ?string $actor_user_id
 * @property Carbon $created_at
 */
#[Table('rfq_status_history', timestamps: false)]
#[Fillable(['organization_id', 'rfq_id', 'from_status', 'to_status', 'note', 'actor_user_id', 'created_at'])]
class RfqStatusChange extends Model
{
    use AppendOnly, BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }
}
