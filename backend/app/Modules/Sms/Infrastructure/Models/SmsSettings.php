<?php

namespace App\Modules\Sms\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * BD1a: the organization's SMS gateway settings (one row, created on the first save). The API
 * key is encrypted at rest (the `encrypted` cast) and never serialized.
 *
 * @property string $id
 * @property string $organization_id
 * @property bool $is_enabled
 * @property string $driver log | http
 * @property ?string $http_url
 * @property string $http_method GET | POST
 * @property string $http_body form | json
 * @property string $param_to
 * @property string $param_message
 * @property ?string $param_sender
 * @property ?string $param_api_key
 * @property ?string $api_key
 * @property ?string $sender_id
 * @property ?array<string, string> $extra_params
 * @property ?string $success_contains
 * @property string $phone_format local | 880 | plus880
 * @property ?int $monthly_limit
 * @property ?array<string, array{enabled?: bool, en?: ?string, bn?: ?string}> $templates
 * @property ?CarbonImmutable $updated_at
 */
#[Fillable(['organization_id', 'is_enabled', 'driver', 'http_url', 'http_method', 'http_body', 'param_to', 'param_message', 'param_sender', 'param_api_key', 'api_key', 'sender_id', 'extra_params', 'success_contains', 'phone_format', 'monthly_limit', 'templates'])]
#[Hidden(['api_key'])]
class SmsSettings extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    protected $table = 'sms_settings';

    protected $attributes = [
        'is_enabled' => false,
        'driver' => 'log',
        'http_method' => 'POST',
        'http_body' => 'form',
        'param_to' => 'to',
        'param_message' => 'message',
        'phone_format' => '880',
    ];

    protected function casts(): array
    {
        return [
            'is_enabled' => 'boolean',
            'api_key' => 'encrypted',
            'extra_params' => 'array',
            'templates' => 'array',
            'monthly_limit' => 'integer',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
