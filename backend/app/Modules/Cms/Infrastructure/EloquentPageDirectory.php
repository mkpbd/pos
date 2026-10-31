<?php

namespace App\Modules\Cms\Infrastructure;

use App\Modules\Cms\Application\Contracts\PageDirectory;
use App\Modules\Cms\Infrastructure\Models\CmsPage;

class EloquentPageDirectory implements PageDirectory
{
    public function visible(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        return CmsPage::query()->visible()->whereIn('id', array_values(array_unique($ids)))->get(['id', 'slug', 'title'])
            ->mapWithKeys(fn (CmsPage $p) => [$p->id => ['id' => $p->id, 'slug' => $p->slug, 'title' => $p->title]])
            ->all();
    }

    public function visibleBySlug(string $slug): ?array
    {
        $page = CmsPage::query()->visible()->whereRaw('lower(slug) = ?', [mb_strtolower($slug)])->first();

        return $page === null ? null : [
            'id' => $page->id,
            'slug' => $page->slug,
            'title' => $page->title,
            'seo_title' => $page->seo_title,
            'seo_description' => $page->seo_description,
        ];
    }

    public function all(): array
    {
        return CmsPage::query()->orderBy('title')->get(['id', 'slug', 'title', 'status'])
            ->map(fn (CmsPage $p) => ['id' => $p->id, 'slug' => $p->slug, 'title' => $p->title, 'status' => $p->status->value])
            ->all();
    }
}
