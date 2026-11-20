<?php

namespace App\Modules\Storefront\Application\Actions;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Application\Support\TranslationInput;
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
        'share_buttons', 'whatsapp_number', 'whatsapp_order_button', 'whatsapp_chat_button',
        // AI2b.
        'assistant_enabled', 'assistant_name', 'assistant_greeting', 'assistant_translations', 'assistant_daily_limit', 'assistant_handoff'];

    public function __construct(
        private readonly StorefrontConfig $config,
        private readonly BranchDirectory $branches,
        private readonly TenantContext $tenant,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * AI2b: `assistant` {enabled?, name?, greeting?, daily_conversation_limit?, handoff?,
     * translations?: {bn: {greeting}}} — partial; a blank name or greeting clears it.
     *
     * @param  array{is_enabled?: bool, site_name?: string, meta_description?: ?string, fulfilment_store_id?: ?string, guest_checkout_enabled?: bool, return_window_days?: int, allow_indexing?: bool, bangla_enabled?: bool, default_locale?: string, bangla_digits?: bool, share_buttons?: bool, whatsapp_number?: ?string, whatsapp_order_button?: bool, whatsapp_chat_button?: bool, assistant?: array<string, mixed>}  $attributes
     */
    public function __invoke(array $attributes): StorefrontSettings
    {
        $assistant = $attributes['assistant'] ?? null;
        unset($attributes['assistant']);

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

        return DB::transaction(function () use ($attributes, $assistant) {
            $settings = $this->config->settings();
            $before = $settings->exists ? $settings->only(self::AUDITED) : [];

            $settings->fill($attributes);
            if (is_array($assistant)) {
                $this->fillAssistant($settings, $assistant);
            }
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

    /**
     * @param  array<string, mixed>  $input  validated `assistant` object
     */
    private function fillAssistant(StorefrontSettings $settings, array $input): void
    {
        $text = fn (mixed $value) => is_string($value) && trim(strip_tags($value)) !== '' ? trim(strip_tags($value)) : null;
        $map = ['enabled' => 'assistant_enabled', 'daily_conversation_limit' => 'assistant_daily_limit', 'handoff' => 'assistant_handoff'];
        foreach ($map as $key => $column) {
            if (array_key_exists($key, $input)) {
                $settings->{$column} = $input[$key];
            }
        }
        if (array_key_exists('name', $input)) {
            $settings->assistant_name = $text($input['name']);
        }
        if (array_key_exists('greeting', $input)) {
            $settings->assistant_greeting = $text($input['greeting']);
        }
        if (array_key_exists('translations', $input)) {
            $translations = $input['translations'];
            if (is_array($translations)) {
                foreach ($translations as $locale => $fields) {
                    if (is_array($fields) && array_key_exists('greeting', $fields)) {
                        $translations[$locale]['greeting'] = $text($fields['greeting']);
                    }
                }
            }
            $settings->assistant_translations = TranslationInput::apply($settings->assistant_translations, $translations, ['greeting']);
        }
    }
}
