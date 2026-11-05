<?php

namespace App\Modules\Cms\Presentation\Http\Support;

use App\Modules\Cms\Infrastructure\Models\CmsPage;
use App\Modules\Cms\Infrastructure\Models\ContactMessage;
use App\Modules\Cms\Infrastructure\Models\FaqItem;
use App\Modules\Cms\Infrastructure\Models\NewsletterSubscriber;
use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Shared\Domain\Translations;
use Illuminate\Support\Collection;

/**
 * Output shapes of the content module (admin and storefront).
 */
final class CmsPresenter
{
    /**
     * @return array<string, mixed>
     */
    public static function page(CmsPage $p, bool $withBody): array
    {
        $data = [
            'id' => $p->id,
            'slug' => $p->slug,
            'title' => $p->title,
            'template' => $p->template->value,
            'status' => $p->status->value,
            'is_visible' => $p->isVisible(),
            'published_at' => $p->published_at?->toIso8601String(),
            'seo_title' => $p->seo_title,
            'seo_description' => $p->seo_description,
            'updated_at' => $p->updated_at?->toIso8601String(),
        ];
        if ($withBody) {
            $data['body_html'] = $p->body_html;
            // E12b: {bn: {title, body_html, seo_title, seo_description}}.
            $data['translations'] = TranslationInput::present($p->translations);
        }

        return $data;
    }

    /**
     * A visible page as the storefront shows it, in `$locale` (per-field fallback, E12b).
     *
     * @return array<string, mixed>
     */
    public static function publicPage(CmsPage $p, string $locale): array
    {
        $data = self::page($p, true);
        unset($data['id'], $data['status'], $data['is_visible'], $data['translations']);

        return array_replace($data, Translations::pickMany($p, ['title', 'body_html', 'seo_title', 'seo_description'], $locale));
    }

    /**
     * @return array<string, mixed>
     */
    public static function faqItem(FaqItem $f): array
    {
        return [
            'id' => $f->id,
            'group' => $f->group,
            'question' => $f->question,
            'answer_html' => $f->answer_html,
            'is_active' => $f->is_active,
            'sort_order' => $f->sort_order,
            // E12b: {bn: {question, answer_html}}.
            'translations' => TranslationInput::present($f->translations),
        ];
    }

    /**
     * Active entries grouped in their sort order; entries without a group come first.
     * Questions and answers in `$locale` (E12b; group names are not translated).
     *
     * @param  Collection<int, FaqItem>  $items
     * @return list<array{group: ?string, items: list<array{id: string, question: string, answer_html: string}>}>
     */
    public static function publicFaq(Collection $items, string $locale = 'en'): array
    {
        $groups = [];
        foreach ($items->sortBy('sort_order') as $item) {
            $key = $item->group ?? '';
            $groups[$key] ??= ['group' => $item->group, 'items' => []];
            $groups[$key]['items'][] = ['id' => $item->id] + Translations::pickMany($item, ['question', 'answer_html'], $locale);
        }
        if (isset($groups[''])) {
            $groups = ['' => $groups['']] + $groups;
        }

        return array_values($groups);
    }

    /**
     * @return array<string, mixed>
     */
    public static function contactMessage(ContactMessage $m): array
    {
        return [
            'id' => $m->id,
            'name' => $m->name,
            'email' => $m->email,
            'phone' => $m->phone,
            'subject' => $m->subject,
            'message' => $m->message,
            'is_handled' => $m->handled_at !== null,
            'handled_at' => $m->handled_at?->toIso8601String(),
            'created_at' => $m->created_at?->toIso8601String(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function subscriber(NewsletterSubscriber $s): array
    {
        return [
            'id' => $s->id,
            'email' => $s->email,
            'status' => $s->status->value,
            'confirmed_at' => $s->confirmed_at?->toIso8601String(),
            'unsubscribed_at' => $s->unsubscribed_at?->toIso8601String(),
            'created_at' => $s->created_at?->toIso8601String(),
        ];
    }
}
