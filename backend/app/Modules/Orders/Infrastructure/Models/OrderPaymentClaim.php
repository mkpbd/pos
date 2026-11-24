<?php

namespace App\Modules\Orders\Infrastructure\Models;

use App\Modules\Orders\Domain\OrderPaymentMethod;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * BD1c: what a shopper reports after sending money with bKash / Nagad / Rocket — the sender
 * number and the transaction ID — for staff to check in their wallet app and confirm or reject.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $order_id
 * @property OrderPaymentMethod $method a Send Money method
 * @property string $purpose full | advance
 * @property string $amount what was due when the claim was submitted
 * @property string $sender_phone 01XXXXXXXXX
 * @property string $transaction_id upper-cased TrxID
 * @property string $status submitted | confirmed | rejected
 * @property ?string $reject_reason
 * @property CarbonImmutable $submitted_at
 * @property ?string $reviewed_by
 * @property ?CarbonImmutable $reviewed_at
 * @property ?string $ip
 */
#[Table('order_payment_claims')]
#[Fillable(['organization_id', 'order_id', 'method', 'purpose', 'amount', 'sender_phone', 'transaction_id', 'status', 'reject_reason', 'submitted_at', 'reviewed_by', 'reviewed_at', 'ip'])]
class OrderPaymentClaim extends Model
{
    use BelongsToOrganization, HasUuids;

    public const SUBMITTED = 'submitted';

    public const CONFIRMED = 'confirmed';

    public const REJECTED = 'rejected';

    public const PURPOSE_FULL = 'full';

    public const PURPOSE_ADVANCE = 'advance';

    protected function casts(): array
    {
        return [
            'method' => OrderPaymentMethod::class,
            'amount' => 'decimal:2',
            'submitted_at' => 'immutable_datetime',
            'reviewed_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
