<?php

namespace App\Modules\Purchasing\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * One daily "quotes overdue" reminder sent for an RFQ (unique per RFQ and local day).
 *
 * @property string $id
 * @property string $rfq_id
 * @property string $run_on
 * @property int $missing
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'rfq_id', 'run_on', 'missing', 'created_at'])]
class RfqReminderRun extends Model
{
    use BelongsToOrganization, HasUuids;
}
