<?php

namespace App\Modules\Authentication\Presentation\Http\Middleware;

use App\Modules\Authentication\Application\Services\TwoFactorPolicy;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Users\Infrastructure\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * G1a setup gate. In the `api` group, ordered right after authentication (bootstrap/app.php):
 * on a staff route (`auth:sanctum`) a user whose organization requires two-factor sign-in and
 * who has not set it up gets 403 `TWO_FACTOR_SETUP_REQUIRED` — cookie sessions and device tokens
 * alike — except on the routes needed to set it up or leave. Public and storefront (`auth:customer`)
 * routes are not affected.
 */
class EnsureTwoFactorSetup
{
    /** Route names a user who must set up two-factor sign-in can still reach. */
    private const ALLOWED_ROUTES = ['auth.me', 'auth.logout', 'auth.options', 'auth.password.change'];

    private const ALLOWED_PREFIX = 'auth.two-factor.';

    public function __construct(private readonly TwoFactorPolicy $policy) {}

    public function handle(Request $request, Closure $next): Response
    {
        $route = $request->route();
        if ($route === null || ! in_array('auth:sanctum', $route->gatherMiddleware(), true)) {
            return $next($request);
        }

        $name = (string) $route->getName();
        if (in_array($name, self::ALLOWED_ROUTES, true) || str_starts_with($name, self::ALLOWED_PREFIX)) {
            return $next($request);
        }

        $user = $request->user();
        if ($user instanceof User && $this->policy->setupRequired($user)) {
            return ApiResponse::error('TWO_FACTOR_SETUP_REQUIRED', 'Your organization requires two-factor sign-in. Set it up to continue.', 403);
        }

        return $next($request);
    }
}
