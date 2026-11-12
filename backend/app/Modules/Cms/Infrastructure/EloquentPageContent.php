<?php

namespace App\Modules\Cms\Infrastructure;

use App\Modules\Cms\Application\Contracts\PageContent;
use App\Modules\Cms\Infrastructure\Models\CmsPage;
use App\Modules\Cms\Infrastructure\Models\FaqItem;
use App\Modules\Cms\Presentation\Http\Support\CmsPresenter;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Domain\Translations;

class EloquentPageContent implements PageContent
{
    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';

    public function __construct(private readonly LocaleContext $locale) {}

    public function find(string $id): ?array
    {
        $id = strtolower($id);
        $page = preg_match(self::UUID, $id) === 1 ? CmsPage::query()->find($id) : null;

        return $page === null ? null : [
            'id' => $page->id,
            'slug' => $page->slug,
            'title' => $page->title,
            'status' => $page->status->value,
            'template' => $page->template->value,
            'body_html' => $page->body_html,
            'translations' => Translations::decode($page->translations),
        ];
    }

    public function summaries(array $ids): array
    {
        $ids = array_values(array_unique(array_filter(array_map('strtolower', $ids), fn (string $id) => preg_match(self::UUID, $id) === 1)));
        if ($ids === []) {
            return [];
        }

        return CmsPage::query()->whereIn('id', $ids)->get(['id', 'slug', 'title', 'status', 'template'])
            ->mapWithKeys(fn (CmsPage $p) => [$p->id => [
                'id' => $p->id,
                'title' => $p->title,
                'slug' => $p->slug,
                'status' => $p->status->value,
                'template' => $p->template->value,
            ]])
            ->all();
    }

    public function publicFaq(): array
    {
        return CmsPresenter::publicFaq(FaqItem::query()->where('is_active', true)->get(), $this->locale->current());
    }
}
