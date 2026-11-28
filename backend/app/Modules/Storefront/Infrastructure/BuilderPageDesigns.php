<?php

namespace App\Modules\Storefront\Infrastructure;

use App\Modules\Cms\Application\Contracts\PageDesigns;
use App\Modules\Storefront\Application\Builder\BuilderPages;
use App\Modules\Storefront\Application\Builder\ManageBuilderDocuments;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Presentation\Http\Support\StaffPreview;
use Illuminate\Http\Request;

/**
 * B4: content pages designed with the store builder (`cms:<page id>` documents) for the Cms
 * module's public page endpoint.
 */
class BuilderPageDesigns implements PageDesigns
{
    public function __construct(
        private readonly BuilderPages $pages,
        private readonly ManageBuilderDocuments $documents,
    ) {}

    /**
     * B22a: through the builder's own delete — versions go with it and the schedules, reviews,
     * comments and edit lease cascade in the database; audited as storefront.builder_deleted.
     */
    public function deleteForPage(string $pageId): bool
    {
        $document = BuilderDocument::query()->where('key', BuilderDocument::CMS_PREFIX.$pageId)->first();
        if ($document === null) {
            return false;
        }
        $this->documents->delete($document);

        return true;
    }

    public function forPage(string $pageId, bool $draft): ?array
    {
        return $this->pages->cmsPage($pageId, $draft);
    }

    public function isDraftPreview(Request $request): bool
    {
        return StaffPreview::draft($request);
    }
}
