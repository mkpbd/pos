<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Redirects\StorefrontRedirects;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * B16: the storefront SPA asks where an address it could not find went (its 404 page), and
 * replaces the location for client-side navigations. Public, HTTP-cached.
 */
class StoreRedirectController
{
    /**
     * Resolve an old address
     *
     * `?path=` → `{to, type: 301|302}` (`to`: a store path or a full URL) or `null` when the
     * address has no redirect. Counted like a server redirect (at most one write a minute).
     */
    public function __invoke(Request $request, StorefrontRedirects $redirects): JsonResponse
    {
        $path = $request->query('path');
        $redirect = is_string($path) && strlen($path) <= 2000 ? $redirects->find($path) : null;
        if ($redirect === null) {
            return ApiResponse::success(null);
        }
        $redirects->hit($redirect);

        return ApiResponse::success(['to' => $redirect->to_path, 'type' => (int) $redirect->type]);
    }
}
