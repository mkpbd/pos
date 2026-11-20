<?php

namespace App\Modules\Cms\Infrastructure;

use App\Modules\Cms\Application\Contracts\PageContent;
use App\Modules\Cms\Domain\PageTemplate;
use App\Modules\Cms\Infrastructure\Models\CmsPage;
use App\Modules\Cms\Infrastructure\Models\FaqItem;
use App\Modules\Cms\Presentation\Http\Support\CmsPresenter;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Domain\PlainText;
use App\Modules\Shared\Domain\Translations;

class EloquentPageContent implements PageContent
{
    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';

    /** AI2b: help excerpts are cut to this many characters. */
    private const EXCERPT = 400;

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

    public function searchHelp(string $query, int $limit): array
    {
        $words = self::words($query);
        if ($words === [] || $limit < 1) {
            return [];
        }
        $locale = $this->locale->current();
        $faqPath = ($faqPage = $this->templatePage(PageTemplate::Faq->value)) === null ? null : '/pages/'.$faqPage['slug'];

        $hits = [];
        foreach (FaqItem::query()->where('is_active', true)->orderBy('sort_order')->get() as $item) {
            $text = Translations::pickMany($item, ['question', 'answer_html'], $locale);
            $score = self::score($words, $item->question.' '.$text['question'], PlainText::fromHtml($item->answer_html).' '.PlainText::fromHtml($text['answer_html']));
            if ($score > 0) {
                $hits[] = ['score' => $score, 'order' => count($hits), 'item' => [
                    'type' => 'faq',
                    'title' => (string) $text['question'],
                    'path' => $faqPath,
                    'excerpt' => PlainText::excerpt($text['answer_html'], self::EXCERPT),
                ]];
            }
        }
        foreach (CmsPage::query()->visible()->orderBy('title')->get(['id', 'slug', 'title', 'body_html', 'translations']) as $page) {
            $text = Translations::pickMany($page, ['title', 'body_html'], $locale);
            $score = self::score($words, $page->title.' '.$text['title'].' '.$page->slug, PlainText::fromHtml($page->body_html).' '.PlainText::fromHtml($text['body_html']));
            if ($score > 0) {
                $hits[] = ['score' => $score, 'order' => count($hits), 'item' => [
                    'type' => 'page',
                    'title' => (string) $text['title'],
                    'path' => '/pages/'.$page->slug,
                    'excerpt' => PlainText::excerpt($text['body_html'], self::EXCERPT),
                ]];
            }
        }
        usort($hits, fn (array $a, array $b) => [$b['score'], $a['order']] <=> [$a['score'], $b['order']]);

        return array_map(fn (array $hit) => $hit['item'], array_slice($hits, 0, $limit));
    }

    public function templatePage(string $template): ?array
    {
        $page = CmsPage::query()->visible()->where('template', $template)->orderBy('created_at')->orderBy('id')->first(['id', 'slug', 'title', 'translations']);

        return $page === null ? null : ['slug' => $page->slug, 'title' => (string) Translations::pick($page, 'title', $this->locale->current())];
    }

    /**
     * Distinct lowercase words of at least two letters (at most 8).
     *
     * @return list<string>
     */
    private static function words(string $query): array
    {
        $words = preg_split('/[^\p{L}\p{N}\p{M}]+/u', mb_strtolower($query), -1, PREG_SPLIT_NO_EMPTY) ?: [];

        return array_slice(array_values(array_unique(array_filter($words, fn (string $w) => mb_strlen($w) >= 2))), 0, 8);
    }

    /**
     * Title words count three times, body words once; 0 = no word found.
     *
     * @param  list<string>  $words
     */
    private static function score(array $words, string $title, string $body): int
    {
        $title = mb_strtolower($title);
        $body = mb_strtolower($body);
        $score = 0;
        foreach ($words as $word) {
            $score += (str_contains($title, $word) ? 3 : 0) + (str_contains($body, $word) ? 1 : 0);
        }

        return $score;
    }
}
