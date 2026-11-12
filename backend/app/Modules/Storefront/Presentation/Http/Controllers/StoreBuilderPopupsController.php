<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Builder\BuilderPopups;
use App\Modules\Storefront\Presentation\Http\Support\StaffPreview;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class StoreBuilderPopupsController
{
    /**
     * Storefront popups and bars
     *
     * Public (B8b). The live popups — published, switched on, inside their schedule — as
     * `{popups: [{id, version, settings: {layout, position, width, overlay, close_on_overlay, label,
     * trigger, frequency, stop_after_action, pages, devices, audience, priority}, payload: {sections,
     * media, data}}], never_on: ["/checkout", "/cart", "/account", "/order"]}` in the request's
     * language, in display order (priority, then the oldest first): the store shows at most one
     * modal / slide-in / fullscreen popup at a time and one bar per edge, and never on a path
     * starting with one of `never_on`. Weak ETag + public caching like the builder pages.
     * `?preview=draft&popup=<id>` from staff of this store holding storefront.view returns that
     * popup's draft only (whatever its switch or schedule; `version` null; `no-store`).
     */
    public function __invoke(Request $request, BuilderPopups $popups): Response
    {
        if (StaffPreview::draft($request) && is_string($request->query('popup'))) {
            return ApiResponse::success($popups->draft($request->query('popup')))->header('Cache-Control', 'no-store, private');
        }

        return ApiResponse::success($popups->live());
    }
}
