<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\OnlinePayments\Application\Contracts\CheckoutPaymentMethods;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Sms\Application\Contracts\SmsSender;
use App\Modules\Storefront\Application\Actions\DeleteStorefrontDomain;
use App\Modules\Storefront\Application\Actions\SaveStorefrontDomain;
use App\Modules\Storefront\Application\Actions\SaveStorefrontSettings;
use App\Modules\Storefront\Application\Actions\SaveTheme;
use App\Modules\Storefront\Application\Contracts\StoreAssistantSettings;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use App\Modules\Storefront\Infrastructure\Models\StorefrontDomain;
use App\Modules\Storefront\Infrastructure\Models\StorefrontSettings;
use App\Modules\Storefront\Presentation\Http\Support\StorefrontPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Storefront settings, domains and theme (admin).
 */
class StorefrontAdminController
{
    private const HOST_PATTERN = '/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/';

    public function showSettings(StorefrontConfig $config, SmsSender $sms, TenantContext $tenant): JsonResponse
    {
        return ApiResponse::success(StorefrontPresenter::settings($config->settings()) + $this->smsState($sms, $tenant));
    }

    /**
     * BD1a: whether SMS is set up (`sms_ready`) and can send sign-in / checkout codes
     * (`otp_ready`) — read-only, beside the checkout phone-check setting.
     *
     * @return array{sms_ready: bool, otp_ready: bool, cod_advance_ready: bool}
     */
    private function smsState(SmsSender $sms, TenantContext $tenant): array
    {
        $organizationId = $tenant->requireOrganization();

        return ['sms_ready' => $sms->ready($organizationId), 'otp_ready' => $sms->otpReady($organizationId),
            // BD1c: the advance delivery charge needs a Send Money method to pay it with (else it acts as off).
            'cod_advance_ready' => app(CheckoutPaymentMethods::class)->sendMoneyMethods() !== []];
    }

    /**
     * Update storefront settings
     *
     * Opening the storefront (`is_enabled: true`) needs at least one domain (`STOREFRONT_DOMAIN_REQUIRED`).
     * `fulfilment_store_id` must be an active store of the organization (`STORE_NOT_FOUND`); its stock
     * decides online availability (null: stock-tracked products show as out of stock).
     * `return_window_days` (0–60, default 7; 0 = no online returns): days after delivery a
     * customer may ask to return goods of a web order (E10b).
     * E12b languages: `bangla_enabled` (default true), `default_locale` `en|bn` (must be
     * enabled: Bangla off + default `bn` -> 422 on `default_locale`), `bangla_digits` (default
     * false: Bengali digits for amounts and numbers when reading in Bangla).
     * P2b: `share_buttons` (default true: the share bar on product, campaign and blog pages);
     * `whatsapp_number` — "01712345678", "+8801712345678", "8801712345678" or any "+<8–15 digits>",
     * stored as digits without "+" ("8801712345678"); null or "" clears it; anything else → 422
     * `whatsapp_number`. `whatsapp_order_button` / `whatsapp_chat_button` (default true) only show
     * while a number is set.
     * AI2b: `assistant` {enabled (default false), name ≤ 40 (blank = "Shop assistant"), greeting
     * ≤ 200 (blank clears), daily_conversation_limit 1–2000 (200), handoff whatsapp|contact|none,
     * translations: {bn: {greeting}}} — partial, audited with the other settings.
     * BD1a: `checkout_email` required | optional (default) | hidden — the customer e-mail field
     * at checkout; `checkout_phone_verification` off (default) | cod | all — which orders need
     * the mobile number checked with an SMS code (≠ off while SMS cannot send codes → 422
     * `SMS_NOT_READY`). Read-only `sms_ready` / `otp_ready` come with the settings.
     * BD1b: `cod_review` off (default) | risky | all — shop and landing-page cash-on-delivery
     * orders start `pending_confirmation` (all of them, or with `risky` those whose mobile
     * number has a delivery success rate below `cod_review_min_success_rate` (0–100, default
     * 70) and, with `cod_review_new_numbers` (default false), numbers without a delivered order).
     * BD1c: `cod_advance` off (default) | risky (the rule above) | all — shop and landing-page COD
     * orders pay an advance by Send Money first (`pending_payment`): `cod_advance_amount`
     * delivery (default: delivery charge + COD fee) | fixed (`cod_advance_fixed` > 0, capped at
     * the total); `cod_advance_hold_hours` 1–168 (24). Read-only `cod_advance_ready`: a Send
     * Money method is on (otherwise the advance acts as off).
     */
    public function updateSettings(Request $request, SaveStorefrontSettings $save, SmsSender $sms, TenantContext $tenant): JsonResponse
    {
        $data = $request->validate([
            'assistant' => ['sometimes', 'array:enabled,name,greeting,daily_conversation_limit,handoff,translations'],
            'assistant.enabled' => ['sometimes', 'boolean'],
            'assistant.name' => ['sometimes', 'nullable', 'string', 'max:40'],
            'assistant.greeting' => ['sometimes', 'nullable', 'string', 'max:200'],
            'assistant.daily_conversation_limit' => ['sometimes', 'integer', 'min:1', 'max:2000'],
            'assistant.handoff' => ['sometimes', Rule::in(StoreAssistantSettings::HANDOFFS)],
            ...TranslationInput::rules(['greeting' => ['max:200']], 'assistant.translations'),
            'share_buttons' => ['sometimes', 'boolean'],
            'whatsapp_number' => ['sometimes', 'nullable', 'string', 'max:30'],
            'whatsapp_order_button' => ['sometimes', 'boolean'],
            'whatsapp_chat_button' => ['sometimes', 'boolean'],
            'is_enabled' => ['sometimes', 'boolean'],
            'site_name' => ['sometimes', 'required', 'string', 'max:120'],
            'meta_description' => ['sometimes', 'nullable', 'string', 'max:300'],
            'fulfilment_store_id' => ['sometimes', 'nullable', 'uuid'],
            'guest_checkout_enabled' => ['sometimes', 'boolean'],
            'return_window_days' => ['sometimes', 'integer', 'min:0', 'max:60'],
            'allow_indexing' => ['sometimes', 'boolean'],
            'bangla_enabled' => ['sometimes', 'boolean'],
            'default_locale' => ['sometimes', Rule::in(LocaleContext::SUPPORTED)],
            'bangla_digits' => ['sometimes', 'boolean'],
            'checkout_email' => ['sometimes', 'string', Rule::in(StorefrontSettings::CHECKOUT_EMAIL_MODES)],
            'checkout_phone_verification' => ['sometimes', 'string', Rule::in(StorefrontSettings::PHONE_VERIFICATION_MODES)],
            'cod_review' => ['sometimes', 'string', Rule::in(StorefrontSettings::COD_REVIEW_MODES)],
            'cod_review_min_success_rate' => ['sometimes', 'integer', 'min:0', 'max:100'],
            'cod_review_new_numbers' => ['sometimes', 'boolean'],
            'cod_advance' => ['sometimes', 'string', Rule::in(StorefrontSettings::COD_ADVANCE_MODES)],
            'cod_advance_amount' => ['sometimes', 'string', Rule::in(StorefrontSettings::COD_ADVANCE_AMOUNTS)],
            'cod_advance_fixed' => ['sometimes', 'nullable', 'numeric', 'gt:0', 'max:9999999', 'decimal:0,2'],
            'cod_advance_hold_hours' => ['sometimes', 'integer', 'min:1', 'max:168'],
        ]);
        if (isset($data['cod_advance_fixed'])) {
            $data['cod_advance_fixed'] = Decimal::round((string) $data['cod_advance_fixed'], 2);
        }

        return ApiResponse::success(StorefrontPresenter::settings($save($data)) + $this->smsState($sms, $tenant));
    }

    public function domains(): JsonResponse
    {
        return ApiResponse::success(StorefrontDomain::query()->orderByDesc('is_primary')->orderBy('host')->get()->map(StorefrontPresenter::domain(...))->all());
    }

    /**
     * Add a domain
     *
     * Host name only (no scheme, port or path), e.g. `shop.example.com`. A host can serve one organization.
     */
    public function storeDomain(Request $request, SaveStorefrontDomain $save): JsonResponse
    {
        $request->merge(['host' => mb_strtolower(trim((string) $request->input('host')))]);
        $data = $request->validate([
            'host' => ['required', 'string', 'max:253', 'regex:'.self::HOST_PATTERN, Rule::unique('storefront_domains', 'host')],
            'is_primary' => ['sometimes', 'boolean'],
            'entry_path' => $this->entryPathRules(),
        ], ['host.regex' => 'Enter a host name such as shop.example.com (no http://, port or path).']);

        return ApiResponse::created(StorefrontPresenter::domain($save(new StorefrontDomain, $data)));
    }

    /**
     * Change a domain
     *
     * `{is_primary?: true}` makes it the primary domain; P2a: `{entry_path?: null | "/p/eid-sale"}`
     * — the page the address opens on (a store path; null = the home page). At least one of them.
     */
    public function updateDomain(Request $request, StorefrontDomain $domain, SaveStorefrontDomain $save): JsonResponse
    {
        $data = $request->validate([
            'is_primary' => [$request->exists('entry_path') ? 'sometimes' : 'required', 'accepted'],
            'entry_path' => $this->entryPathRules(),
        ]);
        $attributes = [];
        if (isset($data['is_primary'])) {
            $attributes['is_primary'] = (bool) $data['is_primary'];
        }
        if (array_key_exists('entry_path', $data)) {
            $attributes['entry_path'] = $data['entry_path'];
        }

        return ApiResponse::success(StorefrontPresenter::domain($save($domain, $attributes)));
    }

    /**
     * P2a: an entry page — null, or a store path ("/p/eid-sale"): starts with one "/", not "/"
     * itself, no query, fragment, spaces or backslashes, at most 255 characters.
     *
     * @return list<mixed>
     */
    private function entryPathRules(): array
    {
        return ['sometimes', 'nullable', 'string', 'max:255', 'regex:#^/(?!/)[^\s?\#\\\\]+$#', function (string $attribute, mixed $value, \Closure $fail) {
            if (is_string($value) && (rtrim($value, '/') === '' || preg_match('#^/(api|go|admin|sanctum|storage)(/|$)#', $value) === 1)) {
                $fail('Choose a page of your store, such as /p/eid-sale.');
            }
        }];
    }

    public function destroyDomain(StorefrontDomain $domain, DeleteStorefrontDomain $delete): JsonResponse
    {
        $delete($domain);

        return ApiResponse::noContent();
    }

    /**
     * Theme settings
     *
     * The live theme. Always the complete document (defaults filled in; B3: `colors.button`,
     * `button_foreground` and `link` default to the theme's primary pair and accent, `button_hover`
     * null = automatic, the type scale and `palette`). `custom_css` is only returned to holders of `storefront.custom_css`.
     */
    public function showTheme(Request $request, StorefrontConfig $config): JsonResponse
    {
        return ApiResponse::success(StorefrontPresenter::theme($config->theme(), $request->user()->can('storefront.custom_css')));
    }

    /**
     * Theme presets
     *
     * The ready-made looks (`default`, `vegan`, `handmade`, `classic`, `kids`), each with the complete theme it
     * produces on a blank theme. Applying one (to the draft, B3) replaces colours, fonts, shape and layout only.
     */
    public function themePresets(): JsonResponse
    {
        return ApiResponse::success(StorefrontPresenter::themePresets());
    }

    /**
     * Replace custom CSS
     *
     * Immediate (not part of the theme draft). Checked against the custom CSS policy (`CUSTOM_CSS_REJECTED`): no `<`, `@import`, `expression(`, escapes, or `url()` outside `/storage/`.
     */
    public function updateCustomCss(Request $request, SaveTheme $save): JsonResponse
    {
        $data = $request->validate(['custom_css' => ['present', 'nullable', 'string']]);

        return ApiResponse::success(StorefrontPresenter::theme($save->customCss($data['custom_css']), true));
    }
}
