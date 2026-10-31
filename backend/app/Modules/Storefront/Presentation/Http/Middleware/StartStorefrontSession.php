<?php

namespace App\Modules\Storefront\Presentation\Http\Middleware;

use Closure;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Http\Request;
use Illuminate\Routing\Pipeline;
use Illuminate\Session\Middleware\StartSession;
use Symfony\Component\HttpFoundation\Response;

/**
 * `storefront.session`: cookie session and CSRF protection for storefront API routes that
 * need them (customer accounts, cart, wishlist, bootstrap).
 *
 * Storefront hosts are not in SANCTUM_STATEFUL_DOMAINS, so the API group gives them no
 * session. This runs the same stack Sanctum uses for first-party SPAs: encrypted cookies,
 * queued cookies, session, CSRF (the SPA echoes the XSRF-TOKEN cookie in X-XSRF-TOKEN on
 * unsafe methods). When Sanctum already made the request stateful (attribute `sanctum`,
 * e.g. a storefront served from a stateful dev host) it does nothing.
 */
class StartStorefrontSession
{
    /** @var list<class-string> */
    public const STACK = [
        EncryptCookies::class,
        AddQueuedCookiesToResponse::class,
        StartSession::class,
        ValidateCsrfToken::class,
    ];

    public function handle(Request $request, Closure $next): Response
    {
        if ($request->attributes->get('sanctum') === true) {
            return $next($request);
        }

        // Same cookie hardening Sanctum applies to its stateful requests.
        config(['session.http_only' => true, 'session.same_site' => 'lax']);

        return (new Pipeline(app()))
            ->send($request)
            ->through(self::STACK)
            ->then(fn (Request $request) => $next($request));
    }
}
