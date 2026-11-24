<?php

namespace App\Modules\Sms\Presentation\Http\Controllers;

use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Sms\Application\Actions\SaveSmsSettings;
use App\Modules\Sms\Application\Queries\SmsConfig;
use App\Modules\Sms\Presentation\Http\Requests\SaveSmsSettingsRequest;
use App\Modules\Sms\Presentation\Http\Support\SmsPresenter;
use Illuminate\Http\JsonResponse;

/**
 * BD1a: Settings → SMS (gateway and order message templates).
 */
class SmsSettingsController
{
    /**
     * SMS settings
     *
     * `{is_enabled, driver: log|http, http_url, http_method: GET|POST, http_body: form|json,
     * param_to, param_message, param_sender, param_api_key, api_key_set, sender_id, extra_params,
     * success_contains, phone_format: local|880|plus880, monthly_limit, templates: {order_placed:
     * {enabled, en, bn}, …}, default_templates, placeholders, ready, otp_ready, usage: {month_sent,
     * month_failed, month_segments}}`. The API key is never returned.
     */
    public function show(TenantContext $tenant, SmsConfig $config, SmsPresenter $presenter): JsonResponse
    {
        return ApiResponse::success($presenter->settings($config->settings($tenant->requireOrganization())));
    }

    /**
     * Change SMS settings
     *
     * Any subset of the fields above. `api_key`: omitted keeps it, null or "" clears it, a string
     * replaces it (write-only). Switching on the HTTP gateway needs `http_url` (https). Templates
     * merge per event and language (≤ 480 characters). Audited without the API key.
     */
    public function update(SaveSmsSettingsRequest $request, SaveSmsSettings $save, SmsPresenter $presenter): JsonResponse
    {
        return ApiResponse::success($presenter->settings($save($request->validated())));
    }
}
