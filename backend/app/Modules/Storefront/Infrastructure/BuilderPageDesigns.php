<?php

namespace App\Modules\Storefront\Infrastructure;

use App\Modules\Cms\Application\Contracts\PageDesigns;
use App\Modules\Storefront\Application\Builder\BuilderPages;
use App\Modules\Storefront\Presentation\Http\Support\StaffPreview;
use Illuminate\Http\Request;

/**
 * B4: content pages designed with the store builder (`cms:<page id>` documents) for the Cms
 * module's public page endpoint.
 */
class BuilderPageDesigns implements PageDesigns
{
    public function __construct(private readonly BuilderPages $pages) {}

    public function forPage(string $pageId, bool $draft): ?array
    {
        return $this->pages->cmsPage($pageId, $draft);
    }

    public function isDraftPreview(Request $request): bool
    {
        return StaffPreview::draft($request);
    }
}
