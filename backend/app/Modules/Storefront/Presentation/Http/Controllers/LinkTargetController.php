<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Cms\Application\Contracts\PageDirectory;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;

class LinkTargetController
{
    /**
     * Menu link targets
     *
     * Records a menu item can link to instead of a typed URL. `pages`: every content page
     * (drafts included; menus show them only once published).
     */
    public function __invoke(PageDirectory $pages): JsonResponse
    {
        return ApiResponse::success(['pages' => $pages->all()]);
    }
}
