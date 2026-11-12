<?php

namespace App\Modules\Cms\Application\Services;

use App\Modules\Cms\Application\Contracts\PageDesigns;
use Illuminate\Http\Request;

/**
 * B4: without the store builder, content pages show their CMS body.
 */
class NoPageDesigns implements PageDesigns
{
    public function forPage(string $pageId, bool $draft): ?array
    {
        return null;
    }

    public function isDraftPreview(Request $request): bool
    {
        return false;
    }
}
