<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Queries\StorefrontHomepage;
use App\Modules\Storefront\Presentation\Http\Middleware\ResolveStorefront;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class StoreHomepageController
{
    /**
     * Storefront homepage
     *
     * Public. Live sections in order, with banners and media resolved; sections whose banners
     * are all inactive or out of schedule are left out. `?preview=1` from a signed-in staff
     * member of this store holding storefront.view also returns disabled, scheduled, expired
     * and empty sections, each with its `state`. Supports `If-None-Match` (ETag).
     */
    public function __invoke(Request $request, StorefrontHomepage $homepage): Response
    {
        $preview = $request->boolean('preview') && $this->isStaff($request);
        $data = $homepage->build($preview) + ['preview' => $preview];
        $etag = hash('xxh128', (string) json_encode($data));

        if (in_array('"'.$etag.'"', $request->getETags(), true)) {
            return response()->noContent(304)->setEtag($etag)->setPrivate();
        }

        $response = ApiResponse::success($data)->setEtag($etag)->setPrivate();

        return $preview ? $response->header('Cache-Control', 'no-store, private') : $response;
    }

    private function isStaff(Request $request): bool
    {
        $user = $request->user();

        return $user instanceof TenantUser
            && $user->isActive()
            && $user->organizationId() === $request->attributes->get(ResolveStorefront::ATTRIBUTE)['organization_id']
            && $user->can('storefront.view');
    }
}
