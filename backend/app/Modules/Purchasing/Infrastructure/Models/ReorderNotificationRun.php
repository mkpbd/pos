<?php

namespace App\Modules\Purchasing\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * One daily reorder notification sent for a store (unique per store and local day).
 *
 * @property string $id
 * @property string $store_id
 * @property string $run_on
 * @property int $items
 * @property int $recipients
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'store_id', 'run_on', 'items', 'recipients', 'created_at'])]
class ReorderNotificationRun extends Model
{
    use BelongsToOrganization, HasUuids;
}
