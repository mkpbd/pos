<?php

namespace App\Modules\Marketing\Application\Actions;

use App\Modules\Marketing\Application\Queries\TrackingConfig;
use App\Modules\Marketing\Infrastructure\Models\TrackingSettings;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * BD1c: changes the current organization's ad pixels and tracking code (the row is created on
 * the first save). The Conversions API token is write-only: omitted keeps it, null or "" clears
 * it, a string replaces it. Pasted code runs raw on every public shop page, so changing it needs
 * storefront.custom_html (`$mayEditCode`; 403 CUSTOM_HTML_FORBIDDEN otherwise — sending the
 * stored code back unchanged is fine). The Conversions API cannot be on without a pixel id and a
 * token (422 `meta_capi_enabled`). Audited as `tracking.settings_updated` with the changed keys
 * — never the token or the code, only `token_changed` / `head_code_changed` / `body_code_changed`.
 */
class SaveTrackingSettings
{
    private const PLAIN = ['meta_pixel_id', 'meta_capi_enabled', 'meta_test_event_code', 'ga4_measurement_id', 'tiktok_pixel_id'];

    private const CODE = ['head_code', 'body_code'];

    public function __construct(
        private readonly TrackingConfig $config,
        private readonly TenantContext $tenant,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $attributes  validated
     */
    public function __invoke(array $attributes, bool $mayEditCode): TrackingSettings
    {
        $organizationId = $this->tenant->requireOrganization();

        return DB::transaction(function () use ($attributes, $mayEditCode, $organizationId) {
            $settings = TrackingSettings::query()->lockForUpdate()->first() ?? $this->config->settings($organizationId);
            $before = $settings->exists ? $this->snapshot($settings) : [];
            $oldToken = $settings->meta_capi_token;
            $codeChanged = [];

            foreach (self::PLAIN as $key) {
                if (! array_key_exists($key, $attributes)) {
                    continue;
                }
                $value = $attributes[$key];
                if (is_string($value)) {
                    $value = trim($value);
                    $value = $value === '' ? null : $value;
                }
                $settings->{$key} = match ($key) {
                    'meta_capi_enabled' => (bool) $value,
                    'ga4_measurement_id', 'tiktok_pixel_id' => $value === null ? null : strtoupper($value),
                    default => $value,
                };
            }
            foreach (self::CODE as $key) {
                if (! array_key_exists($key, $attributes)) {
                    continue;
                }
                $value = is_string($attributes[$key]) && trim($attributes[$key]) !== '' ? trim($attributes[$key]) : null;
                if ($value === $settings->{$key}) {
                    continue;
                }
                if (! $mayEditCode) {
                    throw new BusinessRuleViolation('CUSTOM_HTML_FORBIDDEN', 'Only people allowed to use custom HTML can change the tracking code.', ['field' => $key], 403);
                }
                $settings->{$key} = $value;
                $codeChanged[$key.'_changed'] = true;
            }
            if (array_key_exists('meta_capi_token', $attributes)) {
                $token = trim((string) $attributes['meta_capi_token']);
                $settings->meta_capi_token = $token === '' ? null : $token;
            }

            if ($settings->meta_capi_enabled && ! $settings->capiReady()) {
                throw ValidationException::withMessages(['meta_capi_enabled' => ['Enter the Meta pixel ID and the Conversions API access token to turn the Conversions API on.']]);
            }

            $tokenChanged = $settings->meta_capi_token !== $oldToken;
            [$old, $new] = Changes::between($before, $this->snapshot($settings));
            if (! $settings->exists || $new !== [] || $tokenChanged || $codeChanged !== []) {
                $settings->updated_by = StaffActor::id();
                $settings->save();
            }
            if ($new !== [] || $tokenChanged || $codeChanged !== []) {
                $this->audit->record('tracking.settings_updated', $settings, $old, $new, ($tokenChanged ? ['token_changed' => true] : []) + $codeChanged);
            }

            return $settings;
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(TrackingSettings $settings): array
    {
        $snapshot = [];
        foreach (self::PLAIN as $key) {
            $snapshot[$key] = $settings->{$key};
        }

        return $snapshot + ['meta_capi_token_set' => $settings->hasToken()];
    }
}
