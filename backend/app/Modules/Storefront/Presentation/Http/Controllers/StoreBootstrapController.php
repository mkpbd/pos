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
     * Public. Store identity (with `allow_indexing`, E12), theme tokens (media resolved to
     * URLs), the live announcement and the active menus as trees. `preview` is true when a
     * signed-in staff member views a storefront that is not open yet. Weak `ETag` +
     * `If-None-Match` (304); `private, no-cache` because the shopper session starts here.
     */
    public function __invoke(Request $request, StorefrontBootstrap $bootstrap): Response
    {
        return ApiResponse::success($bootstrap->build() + ['preview' => $request->attributes->get(ResolveStorefront::ATTRIBUTE)['preview']]);
    }
}
