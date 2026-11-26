<?php

namespace App\Modules\Sales\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * POS1d: a digital receipt sent by SMS or e-mail. Append-only; the recipient is stored masked.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $sale_id
 * @property string $channel sms | email
 * @property string $recipient_masked
 * @property ?string $sms_message_id
 * @property string $status queued | skipped | failed
 * @property ?string $created_by
 * @property Carbon $created_at
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'sale_id', 'channel', 'recipient_masked', 'sms_message_id', 'status', 'created_by', 'created_at'])]
class SaleReceiptDelivery extends Model
{
    use AppendOnly, BelongsToOrganization, HasUuids;

    public const CHANNELS = ['sms', 'email'];

    protected function casts(): array
    {
        return [
            'created_at' => 'datetime',
        ];
    }
}
