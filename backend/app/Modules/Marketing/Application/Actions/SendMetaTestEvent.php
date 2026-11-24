<?php

namespace App\Modules\Marketing\Application\Actions;

use App\Modules\Marketing\Application\Contracts\ConversionsApi;
use App\Modules\Marketing\Application\Queries\TrackingConfig;
use App\Modules\Marketing\Domain\MetaConversionEvent;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * BD1c: sends one `PageView` to the Conversions API right away (not queued) with the saved
 * pixel id, token and test event code, so the event shows under "Test events" in Meta's Events
 * Manager. Needs all three (422 on the missing field) — the Conversions API switch does not
 * matter. The answer is stored as the settings' `capi_last_*` and returned.
 */
class SendMetaTestEvent
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly TrackingConfig $config,
        private readonly ConversionsApi $api,
        private readonly StorefrontConfig $storefront,
    ) {}

    /**
     * @return array{status: 'sent'|'failed', error: ?string}
     */
    public function __invoke(?string $ip, ?string $userAgent): array
    {
        $organizationId = $this->tenant->requireOrganization();
        $settings = $this->config->settings($organizationId);
        $errors = [];
        if (! is_string($settings->meta_pixel_id) || $settings->meta_pixel_id === '') {
            $errors['meta_pixel_id'] = ['Save the Meta pixel ID first.'];
        }
        if (! $settings->hasToken()) {
            $errors['meta_capi_token'] = ['Save the Conversions API access token first.'];
        }
        if (! is_string($settings->meta_test_event_code) || $settings->meta_test_event_code === '') {
            $errors['meta_test_event_code'] = ['Save the test event code from Meta Events Manager (Test events) first.'];
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        $url = $this->storefront->primaryUrl() ?? rtrim((string) config('app.url'), '/');
        $event = MetaConversionEvent::pageView('test-'.Str::uuid7(), now(), rtrim($url, '/').'/', $ip, $userAgent);
        $result = $this->api->send((string) $settings->meta_pixel_id, (string) $settings->meta_capi_token, $event, $settings->meta_test_event_code);
        if ($settings->exists) {
            $this->config->recordResult($organizationId, $result['status'], $result['error']);
        }

        return ['status' => $result['status'], 'error' => $result['error']];
    }
}
