<?php

namespace App\Modules\Marketing\Presentation\Http\Controllers;

use App\Modules\Marketing\Application\Actions\SaveTrackingSettings;
use App\Modules\Marketing\Application\Actions\SendMetaTestEvent;
use App\Modules\Marketing\Application\Queries\TrackingConfig;
use App\Modules\Marketing\Presentation\Http\Requests\SaveTrackingSettingsRequest;
use App\Modules\Marketing\Presentation\Http\Support\TrackingPresenter;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * BD1c: Marketing → Tracking & pixels (Meta pixel + Conversions API, GA4, TikTok, pasted code).
 */
class TrackingSettingsController
{
    /**
     * Tracking settings
     *
     * `{meta_pixel_id, meta_capi_enabled, meta_capi_token_set, meta_test_event_code,
     * ga4_measurement_id, tiktok_pixel_id, head_code, body_code, capi_last_status: sent|failed|null,
     * capi_last_error, capi_last_sent_at, updated_at, can_edit_code}`. The access token is never
     * returned. `can_edit_code`: the user holds storefront.custom_html (may change the code).
     */
    public function show(Request $request, TenantContext $tenant, TrackingConfig $config, TrackingPresenter $presenter): JsonResponse
    {
        return ApiResponse::success($presenter->settings($config->settings($tenant->requireOrganization()), self::canEditCode($request)));
    }

    /**
     * Change tracking settings
     *
     * Any subset of the fields above. `meta_pixel_id` 10–20 digits; `ga4_measurement_id`
     * `G-XXXXXXXX`; `tiktok_pixel_id` 10–30 letters and digits; `meta_test_event_code` ≤ 40;
     * `meta_capi_token`: omitted keeps it, null or "" clears it, a string replaces it
     * (write-only). `meta_capi_enabled` true needs a pixel id and a token (422). `head_code` /
     * `body_code` (≤ 20 000 characters, raw on every public shop page): changing them needs
     * storefront.custom_html too, else 403 `CUSTOM_HTML_FORBIDDEN`. Audited without the token or
     * the code.
     */
    public function update(SaveTrackingSettingsRequest $request, SaveTrackingSettings $save, TrackingPresenter $presenter): JsonResponse
    {
        $canEditCode = self::canEditCode($request);

        return ApiResponse::success($presenter->settings($save($request->validated(), $canEditCode), $canEditCode));
    }

    /**
     * Send a test event
     *
     * Sends one `PageView` to the Conversions API now with the saved pixel id, token and test
     * event code (422 naming whichever is missing) → `{status: sent|failed, error}`; it shows
     * under "Test events" in Meta Events Manager. 5 per minute.
     */
    public function test(Request $request, SendMetaTestEvent $send): JsonResponse
    {
        return ApiResponse::success($send($request->ip(), $request->userAgent()));
    }

    private static function canEditCode(Request $request): bool
    {
        return (bool) $request->user()?->can('storefront.custom_html');
    }
}
