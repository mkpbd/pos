<?php

namespace App\Modules\Storefront\Presentation\Http\Middleware;

use App\Modules\Shared\Application\Localization\LocaleContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * HTTP caching of public storefront reads (E12), opted in per route as `storefront.cache`
 * after `storefront` (and `storefront.session` where used).
 *
 * Successful GET/HEAD answers get a weak `ETag` (hash of the body) and `304 Not Modified`
 * on a matching `If-None-Match`. Anonymous answers are `public, max-age=60,
 * stale-while-revalidate=300`; answers a session cookie travels with (the bootstrap starts
 * the shopper session) are `private, no-cache`, and staff previews (a closed store, or a
 * controller that already said `no-store`) stay `no-store, private` without an ETag.
 */
class StorefrontHttpCache
{
    public const PUBLIC = 'public, max-age=60, stale-while-revalidate=300';

    public const PERSONAL = 'private, no-cache';

    public const NO_STORE = 'no-store, private';

    public function __construct(private readonly LocaleContext $locale) {}

    public function handle(Request $request, Closure $next): Response
    {
        /** @var Response $response */
        $response = $next($request);

        if (! $request->isMethodCacheable() || $response->getStatusCode() !== 200) {
            return $response;
        }

        $preview = (bool) ($request->attributes->get(ResolveStorefront::ATTRIBUTE)['preview'] ?? false);
        if ($preview || $response->headers->hasCacheControlDirective('no-store')) {
            $response->headers->set('Cache-Control', self::NO_STORE);

            return $response;
        }

        $content = $response->getContent();
        if ($content === false) {
            return $response;
        }

        $personal = $request->hasSession() || $response->headers->getCookies() !== [];
        $response->headers->set('Cache-Control', $personal ? self::PERSONAL : self::PUBLIC);
        // The envelope's per-request id is not part of the payload; the language is (E12b:
        // an English and a Bangla answer never share an ETag, even with identical bodies).
        $payload = preg_replace('/"request_id":"[^"]*"/', '', $content) ?? $content;
        $response->setEtag(hash('xxh128', $this->locale->current().'|'.$payload), true);
        $response->isNotModified($request);

        return $response;
    }
}
