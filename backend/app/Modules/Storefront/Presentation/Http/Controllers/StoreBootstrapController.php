<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Queries\StorefrontBootstrap;
use App\Modules\Storefront\Presentation\Http\Middleware\ResolveStorefront;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class StoreBootstrapController
{
    /**
     * Storefront bootstrap
     *
     * Public. Store identity, theme tokens (media resolved to URLs), the live announcement
     * and the active menus as trees. `preview` is true when a signed-in staff member views
     * a storefront that is not open yet. Supports `If-None-Match` (ETag).
     */
    public function __invoke(Request $request, StorefrontBootstrap $bootstrap): Response
    {
        $data = $bootstrap->build() + ['preview' => $request->attributes->get(ResolveStorefront::ATTRIBUTE)['preview']];
        $etag = '"'.hash('xxh128', (string) json_encode($data)).'"';

        if (in_array($etag, $request->getETags(), true)) {
            return response()->noContent(304)->setEtag(trim($etag, '"'))->setPrivate();
        }

        return ApiResponse::success($data)->setEtag(trim($etag, '"'))->setPrivate();
    }
}
