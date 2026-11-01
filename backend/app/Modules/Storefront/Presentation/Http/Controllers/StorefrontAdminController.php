<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Actions\DeleteStorefrontDomain;
use App\Modules\Storefront\Application\Actions\SaveStorefrontDomain;
use App\Modules\Storefront\Application\Actions\SaveStorefrontSettings;
use App\Modules\Storefront\Application\Actions\SaveTheme;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use App\Modules\Storefront\Infrastructure\Models\StorefrontDomain;
use App\Modules\Storefront\Presentation\Http\Requests\SaveThemeRequest;
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

    public function showSettings(StorefrontConfig $config): JsonResponse
    {
        return ApiResponse::success(StorefrontPresenter::settings($config->settings()));
    }

    /**
     * Update storefront settings
     *
     * Opening the storefront (`is_enabled: true`) needs at least one domain (`STOREFRONT_DOMAIN_REQUIRED`).
     * `fulfilment_store_id` must be an active store of the organization (`STORE_NOT_FOUND`); its stock
     * decides online availability (null: stock-tracked products show as out of stock).
     * `return_window_days` (0–60, default 7; 0 = no online returns): days after delivery a
     * customer may ask to return goods of a web order (E10b).
     */
    public function updateSettings(Request $request, SaveStorefrontSettings $save): JsonResponse
    {
        $data = $request->validate([
            'is_enabled' => ['sometimes', 'boolean'],
            'site_name' => ['sometimes', 'required', 'string', 'max:120'],
            'meta_description' => ['sometimes', 'nullable', 'string', 'max:300'],
            'fulfilment_store_id' => ['sometimes', 'nullable', 'uuid'],
            'guest_checkout_enabled' => ['sometimes', 'boolean'],
            'return_window_days' => ['sometimes', 'integer', 'min:0', 'max:60'],
        ]);

        return ApiResponse::success(StorefrontPresenter::settings($save($data)));
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
        ], ['host.regex' => 'Enter a host name such as shop.example.com (no http://, port or path).']);

        return ApiResponse::created(StorefrontPresenter::domain($save(new StorefrontDomain, $data)));
    }

    /**
     * Make a domain primary
     */
    public function updateDomain(Request $request, StorefrontDomain $domain, SaveStorefrontDomain $save): JsonResponse
    {
        $data = $request->validate(['is_primary' => ['required', 'accepted']]);

        return ApiResponse::success(StorefrontPresenter::domain($save($domain, ['is_primary' => (bool) $data['is_primary']])));
    }

    public function destroyDomain(StorefrontDomain $domain, DeleteStorefrontDomain $delete): JsonResponse
    {
        $delete($domain);

        return ApiResponse::noContent();
    }

    /**
     * Theme settings
     *
     * Always the complete document (defaults filled in). `custom_css` is only returned to holders of `storefront.custom_css`.
     */
    public function showTheme(Request $request, StorefrontConfig $config): JsonResponse
    {
        return ApiResponse::success(StorefrontPresenter::theme($config->theme(), $request->user()->can('storefront.custom_css')));
    }

    /**
     * Replace theme settings
     *
     * Send the whole document; omitted keys take their defaults. Media ids must exist in the media library (`MEDIA_NOT_FOUND`).
     */
    public function updateTheme(SaveThemeRequest $request, SaveTheme $save): JsonResponse
    {
        return ApiResponse::success(StorefrontPresenter::theme($save->settings($request->validated()), $request->user()->can('storefront.custom_css')));
    }

    /**
     * Replace custom CSS
     *
     * Checked against the custom CSS policy (`CUSTOM_CSS_REJECTED`): no `<`, `@import`, `expression(`, escapes, or `url()` outside `/storage/`.
     */
    public function updateCustomCss(Request $request, SaveTheme $save): JsonResponse
    {
        $data = $request->validate(['custom_css' => ['present', 'nullable', 'string']]);

        return ApiResponse::success(StorefrontPresenter::theme($save->customCss($data['custom_css']), true));
    }
}
