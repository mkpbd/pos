<?php

namespace App\Modules\Storefront\Application\Actions;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use App\Modules\Storefront\Domain\WhatsAppNumber;
use App\Modules\Storefront\Infrastructure\Models\StorefrontDomain;
use App\Modules\Storefront\Infrastructure\Models\StorefrontSettings;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class SaveStorefrontSettings
{
    private const AUDITED = ['is_enabled', 'site_name', 'meta_description', 'fulfilment_store_id', 'guest_checkout_enabled', 'return_window_days', 'allow_indexing', 'bangla_enabled', 'default_locale', 'bangla_digits',
        // P2b.
        'share_buttons', 'whatsapp_number', 'whatsapp_order_button', 'whatsapp_chat_button'];

    public function __construct(
        private readonly StorefrontConfig $config,
        private readonly BranchDirectory $branches,
        private readonly TenantContext $tenant,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{is_enabled?: bool, site_name?: string, meta_description?: ?string, fulfilment_store_id?: ?string, guest_checkout_enabled?: bool, return_window_days?: int, allow_indexing?: bool, bangla_enabled?: bool, default_locale?: string, bangla_digits?: bool, share_buttons?: bool, whatsapp_number?: ?string, whatsapp_order_button?: bool, whatsapp_chat_button?: bool}  $attributes
     */
    public function __invoke(array $attributes): StorefrontSettings
    {
        // P2b: wa.me needs E.164 digits without "+"; an empty value clears the number.
        if (array_key_exists('whatsapp_number', $attributes)) {
            $raw = $attributes['whatsapp_number'];
            $attributes['whatsapp_number'] = $raw === null || trim((string) $raw) === '' ? null : WhatsAppNumber::normalize((string) $raw);
            if ($attributes['whatsapp_number'] === null && $raw !== null && trim((string) $raw) !== '') {
                throw ValidationException::withMessages(['whatsapp_number' => ['Enter a mobile number such as 01712345678 or an international number starting with +.']]);
            }
        }

        $storeId = $attributes['fulfilment_store_id'] ?? null;
        if ($storeId !== null) {
            $store = $this->branches->store($storeId, $this->tenant->requireOrganization());
            if ($store === null || ! $store['is_active']) {
                throw new BusinessRuleViolation('STORE_NOT_FOUND', 'Choose an active store of your organization as the fulfilment store.');
            }
        }

        return DB::transaction(function () use ($attributes) {
            $settings = $this->config->settings();
            $before = $settings->exists ? $settings->only(self::AUDITED) : [];

            $settings->fill($attributes);
            // E12b: the default language must be one shoppers can use.
            if (! $settings->bangla_enabled && $settings->default_locale !== LocaleContext::BASE) {
                throw ValidationException::withMessages(['default_locale' => ['Switch Bangla on before making it the default language.']]);
            }
            if ($settings->is_enabled && ! StorefrontDomain::query()->exists()) {
                throw new BusinessRuleViolation('STOREFRONT_DOMAIN_REQUIRED', 'Add a domain before opening the storefront.');
            }
            $settings->save();

            [$old, $new] = Changes::between($before, $settings->only(self::AUDITED));
            if ($new !== []) {
                $this->audit->record('storefront.settings_updated', $settings, $old, $new);
            }

            return $settings;
        });
    }
}
