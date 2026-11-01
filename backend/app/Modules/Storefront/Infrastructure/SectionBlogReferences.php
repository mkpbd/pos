<?php

namespace App\Modules\Storefront\Infrastructure;

use App\Modules\Cms\Application\Contracts\BlogReferences;
use App\Modules\Storefront\Domain\SectionType;
use App\Modules\Storefront\Infrastructure\Models\HomepageSection;

/**
 * A homepage blog-posts section showing one category keeps it from being deleted.
 */
class SectionBlogReferences implements BlogReferences
{
    public function uses(string $type, string $id): bool
    {
        if ($type !== self::CATEGORY) {
            return false;
        }

        return HomepageSection::query()->where('type', SectionType::BlogPosts)->get(['id', 'type', 'config'])
            ->contains(fn (HomepageSection $s) => ($s->type->normalize($s->config)['category_id'] ?? null) === $id);
    }

    public function describe(): string
    {
        return 'a homepage section';
    }
}
