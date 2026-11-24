<?php

namespace App\Modules\Sms\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * BD1a: one text message (queued → sent | failed, or skipped over the monthly limit). One-time
 * codes are stored masked; the provider's answer is truncated and never holds the API key.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $to_phone
 * @property string $purpose
 * @property string $body
 * @property int $segments
 * @property string $encoding gsm | unicode
 * @property string $driver log | http
 * @property string $status queued | sent | failed | skipped
 * @property ?string $error
 * @property ?int $provider_status
 * @property ?string $provider_response
 * @property int $attempts
 * @property ?string $dedupe_key
 * @property ?string $related_type
 * @property ?string $related_id
 * @property ?CarbonImmutable $sent_at
 * @property ?CarbonImmutable $created_at
 */
#[Fillable(['organization_id', 'to_phone', 'purpose', 'body', 'segments', 'encoding', 'driver', 'status', 'error', 'provider_status', 'provider_response', 'attempts', 'dedupe_key', 'related_type', 'related_id', 'sent_at'])]
class SmsMessage extends Model
{
    use BelongsToOrganization, HasUuids;

    public const PURPOSES = ['otp', 'order_placed', 'order_confirmed', 'order_shipped', 'order_delivered', 'order_cancelled', 'test'];

    public const STATUSES = ['queued', 'sent', 'failed', 'skipped'];

    protected $table = 'sms_messages';

    protected $attributes = [
        'status' => 'queued',
        'attempts' => 0,
    ];

    protected function casts(): array
    {
        return [
            'segments' => 'integer',
            'provider_status' => 'integer',
            'attempts' => 'integer',
            'sent_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
