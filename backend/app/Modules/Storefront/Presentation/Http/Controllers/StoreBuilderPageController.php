<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Builder\BuilderPages;
use App\Modules\Storefront\Presentation\Http\Middleware\ResolveStorefront;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class StoreBuilderPageController
{
    /**
     * Storefront builder page
     *
     * Public. The published version of the builder home page (`home`) or a landing page
     * (slug) as a render payload: `{document, sections, media, data}`; 404 PAGE_NOT_FOUND when
     * there is none. `?preview=draft` from a signed-in staff member of this store holding
     * storefront.view returns the draft instead (hidden, scheduled and empty nodes kept with
     * their `state`; `no-store`). Weak ETag + 304 and public caching like /store/homepage.
     */
    public function __invoke(Request $request, string $slug, BuilderPages $pages): Response
    {
        $key = BuilderPages::key($slug);
        $preview = $request->query('preview') === 'draft' && $this->isStaff($request);
        $payload = $preview ? $pages->draft($key) : $pages->published($key);
        if ($payload === null) {
            return ApiResponse::error('PAGE_NOT_FOUND', 'This page does not exist.', 404);
        }

        $response = ApiResponse::success($payload);

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
