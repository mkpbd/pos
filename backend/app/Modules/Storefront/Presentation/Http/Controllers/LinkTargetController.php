<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Cms\Application\Contracts\PageDirectory;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;

class LinkTargetController
{
    /**
     * Menu link targets
     *
     * Records a menu item can link to instead of a typed URL. `pages`: every content page
     * (drafts included; menus show them only once published). `categories` (tree order with
     * `depth`) and `brands`: every catalog category and brand with its storefront `url`, null
     * while it has no visible listing (menus show them only while visible).
     */
    public function __invoke(PageDirectory $pages, StorefrontCatalog $catalog): JsonResponse
    {
        return ApiResponse::success(['pages' => $pages->all()] + $catalog->linkTargets());
    }
}
