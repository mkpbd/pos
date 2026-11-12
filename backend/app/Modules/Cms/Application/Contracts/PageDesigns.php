<?php

namespace App\Modules\Cms\Application\Contracts;

use Illuminate\Http\Request;

/**
 * B4: a content page designed with the store builder. Declared here so the public page
 * (`GET /store/pages/{slug}`) can carry the design; implemented by the Storefront module
 * (`NoPageDesigns` — never a design — when it is absent).
 */
interface PageDesigns
{
    /**
     * The builder render payload `{document, sections, media, data}` of the page: the
     * published version, or the draft for a staff draft preview (`$draft`); null when the page
     * has no (published) builder document — the storefront then shows the CMS body.
     *
     * @return array<string, mixed>|null
     */
    public function forPage(string $pageId, bool $draft): ?array;

    /**
     * Whether the request is a staff draft preview of the store (`?preview=draft` from a signed-in
     * staff member of this store holding storefront.view).
     */
    public function isDraftPreview(Request $request): bool;
}
