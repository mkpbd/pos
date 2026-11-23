<?php

namespace App\Modules\Shared\Infrastructure\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * G1a: security headers on every Laravel response (global middleware). A header that a route
 * already set is never overwritten.
 *
 * - Everywhere: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
 *   `Permissions-Policy` turning off camera, microphone, geolocation and payment (nothing served
 *   by Laravel uses them; the admin SPA is served by the web server, not here).
 * - HTTPS requests with `pos.security.hsts` on: `Strict-Transport-Security` (one year, subdomains).
 * - API (`api/*`): never framed (`X-Frame-Options: DENY`) and no content may load
 *   (`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`) — JSON only.
 * - HTML pages (storefront shell, API docs): `Content-Security-Policy: frame-ancestors 'self'
 *   <admin origin>` — only the store itself and the admin app (FRONTEND_URL) may frame them. No
 *   script-src yet: store themes allow embeds and custom code (follow-up).
 */
class SecurityHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);
        $headers = $response->headers;

        $set = function (string $name, string $value) use ($headers): void {
            if (! $headers->has($name)) {
                $headers->set($name, $value);
            }
        };

        $set('X-Content-Type-Options', 'nosniff');
        $set('Referrer-Policy', 'strict-origin-when-cross-origin');
        $set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

        if ($request->isSecure() && config('pos.security.hsts')) {
            $set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }

        if ($request->is('api/*')) {
            $set('X-Frame-Options', 'DENY');
            $set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        } elseif (str_starts_with(strtolower((string) $headers->get('Content-Type')), 'text/html')) {
            $set('Content-Security-Policy', trim("frame-ancestors 'self' ".self::adminOrigin()));
        }

        return $response;
    }

    /** Scheme, host and port of FRONTEND_URL (the admin app), or '' when it is not a URL. */
    private static function adminOrigin(): string
    {
        $parts = parse_url((string) config('pos.frontend_url'));
        if (! is_array($parts) || ! isset($parts['scheme'], $parts['host']) || ! in_array(strtolower($parts['scheme']), ['http', 'https'], true)) {
            return '';
        }

        return strtolower($parts['scheme']).'://'.strtolower($parts['host']).(isset($parts['port']) ? ':'.$parts['port'] : '');
    }
}
