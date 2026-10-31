<?php

namespace App\Modules\Storefront\Infrastructure;

use App\Modules\Cms\Application\Contracts\PageReferences;
use App\Modules\Storefront\Domain\MenuItemType;
use App\Modules\Storefront\Infrastructure\Models\MenuItem;

/**
 * Menu items linking to a content page keep it from being deleted.
 */
class MenuPageReferences implements PageReferences
{
    public function uses(string $pageId): bool
    {
        return MenuItem::query()->where('type', MenuItemType::Page)->where('target_id', $pageId)->exists();
    }
}
