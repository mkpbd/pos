<?php

namespace App\Modules\Marketing\Application\Queries;

use App\Modules\Marketing\Infrastructure\Models\TrackingSettings;

/**
 * BD1c: an organization's tracking settings (defaults — nothing set — as an unsaved model when
 * never saved) and the record of the last Conversions API answer. Every method takes the
 * organization explicitly (callers may run in a queue worker).
 */
class TrackingConfig
{
    public function settings(string $organizationId): TrackingSettings
    {
        /** @var TrackingSettings|null $settings */
        $settings = TrackingSettings::query()->withoutGlobalScope('organization')->where('organization_id', $organizationId)->first();

        return $settings ?? new TrackingSettings(['organization_id' => $organizationId]);
    }

    /**
     * Stores the last Conversions API result (`sent` | `failed`, the error ≤ 200 characters).
     */
    public function recordResult(string $organizationId, string $status, ?string $error): void
    {
        // Not a settings change: updated_at / updated_by stay.
        TrackingSettings::query()->withoutGlobalScope('organization')->where('organization_id', $organizationId)->toBase()->update([
            'capi_last_status' => $status,
            'capi_last_error' => $error === null ? null : mb_substr($error, 0, 200),
            'capi_last_sent_at' => now(),
        ]);
    }
}
