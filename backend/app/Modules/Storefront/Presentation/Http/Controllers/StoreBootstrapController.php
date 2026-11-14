<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Builder\ManageThemeDraft;
use App\Modules\Storefront\Application\Queries\StorefrontBootstrap;
use App\Modules\Storefront\Infrastructure\Models\StorefrontDomain;
use App\Modules\Storefront\Presentation\Http\Middleware\ResolveStorefront;
use App\Modules\Storefront\Presentation\Http\Support\StaffPreview;
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
     *
     * B3: `?preview=draft` from a signed-in staff member of this store holding storefront.view
     * carries the **draft** theme instead of the live one, with `theme_source: "draft"`
     * (`no-store`); anyone else gets the live theme.
     *
     * B4: `builder` is `{home: bool, header, footer, zones: {listing.top, listing.bottom,
     * product.after}}` — each a builder render payload `{document, sections, media, data}` of
     * the published document, or null (the classic rendering). The staff draft preview carries
     * the drafts (also of documents never published). Publishing any of them refreshes the
     * cached bootstrap.
     *
     * P2a: `entry_path` — the page the requested host opens on (its domain's entry page, e.g.
     * `/p/eid-sale`), null for the home page.
     */
    public function __invoke(Request $request, StorefrontBootstrap $bootstrap, ManageThemeDraft $theme, ResolveStorefront $resolver): Response
    {
        $preview = $request->attributes->get(ResolveStorefront::ATTRIBUTE)['preview'];
        // P2a: the page this address opens on (its storefront domain's entry page), or null.
        $entryPath = StorefrontDomain::query()->where('host', $resolver->host($request))->value('entry_path');
        $extra = ['preview' => $preview, 'entry_path' => is_string($entryPath) ? $entryPath : null];
        if (StaffPreview::draft($request)) {
            return ApiResponse::success($bootstrap->buildWithTheme($theme->settings()) + $extra + ['theme_source' => 'draft'])
                ->header('Cache-Control', 'no-store, private');
        }

        return ApiResponse::success($bootstrap->build() + $extra);
    }
}
