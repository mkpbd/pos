<?php

namespace App\Modules\Storefront\Infrastructure;

use App\Modules\Cms\Application\Contracts\BlogReferences;
use App\Modules\Storefront\Infrastructure\Models\MenuItem;

/**
 * Menu items linking to a blog category or post keep it from being deleted.
 */
class MenuBlogReferences implements BlogReferences
{
    public function uses(string $type, string $id): bool
    {
        return MenuItem::query()->where('type', $type)->where('target_id', $id)->exists();
    }

    public function describe(): string
    {
        return 'a menu';
    }
}
