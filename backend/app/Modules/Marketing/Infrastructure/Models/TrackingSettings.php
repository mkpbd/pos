<?php

namespace App\Modules\Marketing\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * BD1c: the organization's ad pixels and tracking code (one row, created on the first save).
 * The Conversions API access token is encrypted at rest (the `encrypted` cast) and never
 * serialized.
 *
 * @property string $id
 * @property string $organization_id
 * @property ?string $meta_pixel_id
 * @property bool $meta_capi_enabled
 * @property ?string $meta_capi_token
 * @property ?string $meta_test_event_code
 * @property ?string $ga4_measurement_id
 * @property ?string $tiktok_pixel_id
 * @property ?string $head_code
 * @property ?string $body_code
 * @property ?string $capi_last_status sent | failed
 * @property ?string $capi_last_error
 * @property ?CarbonImmutable $capi_last_sent_at
 * @property ?string $updated_by
 * @property ?CarbonImmutable $updated_at
 */
#[Fillable(['organization_id', 'meta_pixel_id', 'meta_capi_enabled', 'meta_capi_token', 'meta_test_event_code', 'ga4_measurement_id', 'tiktok_pixel_id', 'head_code', 'body_code', 'capi_last_status', 'capi_last_error', 'capi_last_sent_at', 'updated_by'])]
#[Hidden(['meta_capi_token'])]
class TrackingSettings extends Model
{
    use BelongsToOrganization, HasUuids;

    protected $table = 'tracking_settings';

    protected $attributes = [
        'meta_capi_enabled' => false,
    ];

    protected function casts(): array
    {
        return [
            'meta_capi_enabled' => 'boolean',
            'meta_capi_token' => 'encrypted',
            'capi_last_sent_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    public function hasToken(): bool
    {
        return is_string($this->meta_capi_token) && $this->meta_capi_token !== '';
    }

    /** The Conversions API can send: switched on with a pixel id and an access token. */
    public function capiReady(): bool
    {
        return $this->meta_capi_enabled && is_string($this->meta_pixel_id) && $this->meta_pixel_id !== '' && $this->hasToken();
    }
}
