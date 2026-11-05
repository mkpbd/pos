<?php

namespace App\Modules\Cms\Infrastructure;

use App\Modules\Cms\Application\Contracts\PageDirectory;
use App\Modules\Cms\Domain\PageStatus;
use App\Modules\Cms\Infrastructure\Models\CmsPage;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Domain\Translations;
use Carbon\CarbonImmutable;

class EloquentPageDirectory implements PageDirectory
{
    /** E12b: titles and SEO texts in the request's language. */
    public function __construct(private readonly LocaleContext $locale) {}

    public function visible(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        return CmsPage::query()->visible()->whereIn('id', array_values(array_unique($ids)))->get(['id', 'slug', 'title', 'translations'])
            ->mapWithKeys(fn (CmsPage $p) => [$p->id => ['id' => $p->id, 'slug' => $p->slug, 'title' => Translations::pick($p, 'title', $this->locale->current())]])
            ->all();
    }

    public function visibleBySlug(string $slug): ?array
    {
        $page = CmsPage::query()->visible()->whereRaw('lower(slug) = ?', [mb_strtolower($slug)])->first();

        return $page === null ? null : [
            'id' => $page->id,
            'slug' => $page->slug,
        ] + Translations::pickMany($page, ['title', 'seo_title', 'seo_description'], $this->locale->current());
    }

    public function all(): array
    {
        return CmsPage::query()->orderBy('title')->get(['id', 'slug', 'title', 'status'])
            ->map(fn (CmsPage $p) => ['id' => $p->id, 'slug' => $p->slug, 'title' => $p->title, 'status' => $p->status->value])
            ->all();
    }

    public function nextPublicationAt(): ?CarbonImmutable
    {
        $next = CmsPage::query()->where('status', PageStatus::Published)->where('published_at', '>', now())->min('published_at');

        return $next === null ? null : CarbonImmutable::parse($next);
    }

    public function sitemapEntries(): array
    {
        return CmsPage::query()->visible()->orderBy('slug')->get(['slug', 'updated_at'])
            ->map(fn (CmsPage $p) => ['slug' => $p->slug, 'updated_at' => $p->updated_at])->all();
    }
}
