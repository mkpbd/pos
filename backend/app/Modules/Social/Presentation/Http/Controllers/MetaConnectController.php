<?php

namespace App\Modules\Social\Presentation\Http\Controllers;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Social\Application\Actions\ConnectMeta;
use App\Modules\Social\Application\Queries\SocialConfig;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * P2b: connecting Facebook — browser navigations (web routes under /api/v1/social/meta, so the
 * staff session cookie works even when Facebook is the referrer). Every outcome is a 302: to the
 * Facebook Login dialog, or back to `/admin/marketing/social?connected=1` / `?error=<code>`
 * (`session_expired` without a signed-in staff user holding social.manage, plus ConnectMeta's
 * codes). Location headers of the admin page are relative, so the browser stays on its host.
 */
class MetaConnectController
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
    ) {}

    /**
     * Connect Facebook (browser navigation)
     *
     * Sandbox: stores "Demo Page" (@demo_shop) and "Demo Page 2", then 302 to the Social page with
     * `?connected=1`. Live: 302 to the Facebook Login dialog (needs the app id and secret, else
     * `?error=app_not_configured`).
     */
    public function connect(Request $request, ConnectMeta $connect): RedirectResponse
    {
        $user = $this->staff($request);
        if ($user === null) {
            return self::to(SocialConfig::adminUrl(['error' => 'session_expired']));
        }
        $organizationId = (string) $user->organizationId();

        return self::to($this->tenant->runAs($organizationId, fn () => $connect->start((string) $user->getAuthIdentifier(), $organizationId)));
    }

    /**
     * Facebook Login callback (browser navigation)
     *
     * `?code&state` (or `?error=access_denied`) from Facebook → 302 to the Social page with
     * `?connected=1` or `?error=<code>`.
     */
    public function callback(Request $request, ConnectMeta $connect): RedirectResponse
    {
        $user = $this->staff($request);
        if ($user === null) {
            return self::to(SocialConfig::adminUrl(['error' => 'session_expired']));
        }
        $organizationId = (string) $user->organizationId();
        $query = array_filter($request->query(), fn ($v) => is_string($v));

        return self::to($this->tenant->runAs($organizationId, fn () => $connect->complete((string) $user->getAuthIdentifier(), $organizationId, $query)));
    }

    /**
     * The signed-in, active staff user of an active organization who may manage social media.
     */
    private function staff(Request $request): ?TenantUser
    {
        $user = $request->user();
        if (! $user instanceof TenantUser || ! $user instanceof Authenticatable || ! $user->isActive() || $user->organizationId() === null) {
            return null;
        }
        if (! $this->organizations->isActive($user->organizationId()) || ! Gate::forUser($user)->allows('social.manage')) {
            return null;
        }

        return $user;
    }

    private static function to(string $location): RedirectResponse
    {
        return (new RedirectResponse($location, 302))->header('Cache-Control', 'no-store, private');
    }
}
