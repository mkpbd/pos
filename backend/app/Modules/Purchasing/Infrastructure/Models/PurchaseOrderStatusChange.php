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
 * One step of a purchase order's status history (SC2; append-only; actor NULL = the system).
 *
 * @property string $id
 * @property string $purchase_order_id
 * @property ?string $from_status
 * @property string $to_status
 * @property ?string $note
 * @property ?string $actor_user_id
 * @property Carbon $created_at
 */
#[Table('purchase_order_status_history', timestamps: false)]
#[Fillable(['organization_id', 'purchase_order_id', 'from_status', 'to_status', 'note', 'actor_user_id', 'created_at'])]
class PurchaseOrderStatusChange extends Model
{
    use AppendOnly, BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }
}
