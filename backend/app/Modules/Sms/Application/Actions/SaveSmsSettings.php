<?php

namespace App\Modules\Sms\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Sms\Application\Queries\SmsConfig;
use App\Modules\Sms\Domain\SmsTemplate;
use App\Modules\Sms\Infrastructure\Models\SmsSettings;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * BD1a: changes the current organization's SMS settings (the row is created on the first save).
 * The API key is write-only: omitted keeps it, null or "" clears it. Template changes merge per
 * event and language. Switching on the HTTP gateway needs its address. Audited as
 * `sms.settings_updated` with the changed keys — never the key itself, only `api_key_changed`.
 */
class SaveSmsSettings
{
    private const PLAIN = ['is_enabled', 'driver', 'http_url', 'http_method', 'http_body', 'param_to', 'param_message', 'param_sender', 'param_api_key', 'sender_id', 'success_contains', 'phone_format', 'monthly_limit'];

    public function __construct(
        private readonly SmsConfig $config,
        private readonly TenantContext $tenant,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $attributes  validated
     */
    public function __invoke(array $attributes): SmsSettings
    {
        $organizationId = $this->tenant->requireOrganization();

        return DB::transaction(function () use ($attributes, $organizationId) {
            $settings = SmsSettings::query()->lockForUpdate()->first() ?? $this->config->settings($organizationId);
            $before = $settings->exists ? $this->snapshot($settings) : [];
            $oldKey = $settings->api_key;

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
                    'is_enabled' => (bool) $value,
                    'param_to' => $value ?? 'to',
                    'param_message' => $value ?? 'message',
                    'monthly_limit' => $value === null ? null : (int) $value,
                    default => $value,
                };
            }
            if (array_key_exists('api_key', $attributes)) {
                $key = trim((string) $attributes['api_key']);
                $settings->api_key = $key === '' ? null : $key;
            }
            if (array_key_exists('extra_params', $attributes)) {
                $extra = [];
                foreach ((array) ($attributes['extra_params'] ?? []) as $name => $value) {
                    $extra[trim((string) $name)] = trim((string) $value);
                }
                $settings->extra_params = $extra === [] ? null : $extra;
            }
            if (array_key_exists('templates', $attributes)) {
                $settings->templates = $this->mergeTemplates($settings->templates, (array) ($attributes['templates'] ?? []));
            }

            if ($settings->is_enabled && $settings->driver === 'http' && trim((string) $settings->http_url) === '') {
                throw ValidationException::withMessages(['http_url' => ['Enter the address of your SMS gateway to send real messages.']]);
            }

            $keyChanged = $settings->api_key !== $oldKey;
            $settings->save();

            [$old, $new] = Changes::between($before, $this->snapshot($settings));
            if ($new !== [] || $keyChanged) {
                $this->audit->record('sms.settings_updated', $settings, $old, $new, $keyChanged ? ['api_key_changed' => true] : []);
            }

            return $settings;
        });
    }

    /**
     * @param  array<string, mixed>|null  $saved
     * @param  array<string, mixed>  $changes  {event: {enabled?, en?, bn?}}
     * @return array<string, array<string, mixed>>
     */
    private function mergeTemplates(?array $saved, array $changes): array
    {
        $templates = is_array($saved) ? $saved : [];
        foreach ($changes as $event => $row) {
            if (! array_key_exists($event, SmsTemplate::ENABLED_BY_DEFAULT) || ! is_array($row)) {
                continue;
            }
            $current = is_array($templates[$event] ?? null) ? $templates[$event] : [];
            if (array_key_exists('enabled', $row)) {
                $current['enabled'] = (bool) $row['enabled'];
            }
            foreach (['en', 'bn'] as $locale) {
                if (array_key_exists($locale, $row)) {
                    $current[$locale] = trim((string) $row[$locale]);
                }
            }
            $templates[$event] = $current;
        }

        return $templates;
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(SmsSettings $settings): array
    {
        $snapshot = [];
        foreach (self::PLAIN as $key) {
            $snapshot[$key] = $settings->{$key};
        }

        return $snapshot + [
            'extra_params' => $settings->extra_params,
            'templates' => $settings->templates,
            'api_key_set' => is_string($settings->api_key) && $settings->api_key !== '',
        ];
    }
}
