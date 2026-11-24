<?php

namespace App\Modules\Sms\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * BD1a: a one-time code sent to a phone (only its HMAC is stored).
 *
 * @property string $id
 * @property string $organization_id
 * @property string $phone
 * @property string $purpose login | checkout | verify_phone
 * @property string $code_hash
 * @property int $attempts
 * @property CarbonImmutable $expires_at
 * @property ?CarbonImmutable $consumed_at
 * @property ?string $ip
 * @property CarbonImmutable $created_at
 */
#[Fillable(['organization_id', 'phone', 'purpose', 'code_hash', 'attempts', 'expires_at', 'consumed_at', 'ip', 'created_at'])]
#[Hidden(['code_hash'])]
class SmsOtp extends Model
{
    use BelongsToOrganization, HasUuids;

    public const UPDATED_AT = null;

    protected $table = 'sms_otps';

    protected $attributes = [
        'attempts' => 0,
    ];

    protected function casts(): array
    {
        return [
            'attempts' => 'integer',
            'expires_at' => 'immutable_datetime',
            'consumed_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
        ];
    }
}
