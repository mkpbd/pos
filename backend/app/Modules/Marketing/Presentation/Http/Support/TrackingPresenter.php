<?php

namespace App\Modules\Marketing\Presentation\Http\Support;

use App\Modules\Marketing\Infrastructure\Models\TrackingSettings;

/**
 * BD1c: API shape of the tracking settings — the Conversions API token never leaves the server
 * (only `meta_capi_token_set`).
 */
class TrackingPresenter
{
    /**
     * @return array<string, mixed>
     */
    public function settings(TrackingSettings $settings, bool $canEditCode): array
    {
        return [
            'meta_pixel_id' => $settings->meta_pixel_id,
            'meta_capi_enabled' => (bool) $settings->meta_capi_enabled,
            'meta_capi_token_set' => $settings->hasToken(),
            'meta_test_event_code' => $settings->meta_test_event_code,
            'ga4_measurement_id' => $settings->ga4_measurement_id,
            'tiktok_pixel_id' => $settings->tiktok_pixel_id,
            'head_code' => $settings->head_code,
            'body_code' => $settings->body_code,
            'capi_last_status' => $settings->capi_last_status,
            'capi_last_error' => $settings->capi_last_error,
            'capi_last_sent_at' => $settings->capi_last_sent_at?->toIso8601String(),
            'updated_at' => $settings->updated_at?->toIso8601String(),
            'can_edit_code' => $canEditCode,
        ];
    }
}
