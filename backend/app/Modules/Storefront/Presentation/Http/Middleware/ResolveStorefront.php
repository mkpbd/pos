<?php

namespace App\Modules\Storefront\Presentation\Http\Middleware;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Contracts\TenantUser;
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
 */
class ResolveStorefront
{
    public const ATTRIBUTE = 'storefront';

    public function __construct(
        private readonly TenantContext $context,
        private readonly OrganizationDirectory $organizations,
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

        $enabled = (bool) StorefrontSettings::query()
            ->withoutGlobalScope('organization')
            ->where('organization_id', $organizationId)
            ->value('is_enabled');

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

        try {
            return $next($request);
        } finally {
            $this->context->setOrganization(null);
        }
    }

    /**
     * Lower-case host without port. Local development hosts map to the configured
     * storefront host so `localhost` can serve one organization's store.
     */
    private function host(Request $request): string
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
