<?php

namespace App\Modules\Storefront\Infrastructure;

use App\Modules\Cms\Application\Contracts\BlogReferences;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderVersion;

/**
 * A store builder page (draft or version, B1) whose blog-posts element shows one category
 * keeps that category from being deleted (a text match on the uuid).
 */
class BuilderBlogReferences implements BlogReferences
{
    public function uses(string $type, string $id): bool
    {
        if ($type !== self::CATEGORY) {
            return false;
        }
        $pattern = '%'.strtolower($id).'%';

        return BuilderDocument::query()->whereRaw('CAST(draft AS TEXT) LIKE ?', [$pattern])->exists()
            || BuilderVersion::query()->whereRaw('CAST(content AS TEXT) LIKE ?', [$pattern])->exists();
    }

    public function describe(): string
    {
        return 'a store builder page';
    }
}
