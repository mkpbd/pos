<?php

namespace App\Modules\Storefront\Presentation\Http\Middleware;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Infrastructure\Models\StorefrontDomain;
use App\Modules\Storefront\Infrastructure\Models\StorefrontSettings;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolves the organization of a public storefront request from its host name
 * (ADR-001) and puts it in the tenant context, so the organization scope protects
 * every query that follows exactly as on staff routes.
 *
 * Unknown hosts, suspended organizations and closed storefronts are 404. Staff of the
 * organization holding storefront.view may still preview a closed storefront in the
 * browser they are signed in with. Usage: `storefront` (JSON) or `storefront:web` (HTML).
 *
 * E12b: it also resolves the request's language into the LocaleContext — JSON requests only
 * from `?lang=` (the locale is part of the URL, so HTTP caches stay correct), HTML requests
 * from `?lang=`, then the `lang` cookie, then the store's `default_locale`; a missing,
 * unknown or disabled language means the default (`en` while Bangla is off). Every answer
 * carries `Content-Language`.
 */
class ResolveStorefront
{
    public const ATTRIBUTE = 'storefront';

    public function __construct(
        private readonly TenantContext $context,
        private readonly OrganizationDirectory $organizations,
        private readonly LocaleContext $locale,
    ) {}

    public function handle(Request $request, Closure $next, string $mode = 'api'): Response
    {
        $domain = StorefrontDomain::query()
            ->withoutGlobalScope('organization')
            ->where('host', $this->host($request))
            ->first();

        $organizationId = $domain?->organization_id;
        if ($organizationId === null || ! $this->organizations->isActive($organizationId)) {
            return $this->notFound($mode);
        }

        $settings = StorefrontSettings::query()
            ->withoutGlobalScope('organization')
            ->where('organization_id', $organizationId)
            ->first(['is_enabled', 'bangla_enabled', 'default_locale', 'bangla_digits']);
        $enabled = (bool) $settings?->is_enabled;

        $preview = false;
        if (! $enabled) {
            $user = $request->user();
            $preview = $user instanceof TenantUser
                && $user->isActive()
                && $user->organizationId() === $organizationId
                && $user->can('storefront.view');
            if (! $preview) {
                return $this->notFound($mode);
            }
        }

        $request->attributes->set(self::ATTRIBUTE, ['organization_id' => $organizationId, 'preview' => $preview]);
        $this->context->setOrganization($organizationId);

        $bangla = (bool) ($settings->bangla_enabled ?? true);
        $default = (string) ($settings->default_locale ?? LocaleContext::BASE);
        $requested = $request->query('lang');
        if ($mode === 'web' && LocaleContext::resolve($requested, $bangla, '') !== $requested) {
            // No (valid) ?lang= on a page: the language the shopper picked last time.
            $requested = $request->cookie('lang');
        }
        $this->locale->configure($bangla, $default, LocaleContext::resolve($requested, $bangla, $default), (bool) ($settings->bangla_digits ?? false));

        try {
            $response = $next($request);
            $response->headers->set('Content-Language', $this->locale->current());

            return $response;
        } finally {
            $this->context->setOrganization(null);
            $this->locale->reset();
        }
    }

    /**
     * Lower-case host without port. Local development hosts map to the configured
     * storefront host so `localhost` can serve one organization's store.
     */
    public function host(Request $request): string
    {
        $host = mb_strtolower($request->getHost());
        $default = config('storefront.default_host');

        return is_string($default) && $default !== '' && in_array($host, (array) config('storefront.local_hosts'), true)
            ? mb_strtolower($default)
            : $host;
    }

    private function notFound(string $mode): Response
    {
        return $mode === 'web'
            ? response()->view('storefront::not-found', [], 404)
            : ApiResponse::error('STOREFRONT_NOT_FOUND', 'There is no open store at this address.', 404);
    }
}
