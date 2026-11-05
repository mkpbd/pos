<?php

namespace App\Modules\Cms\Application\Actions;

use App\Modules\Cms\Infrastructure\Models\FaqItem;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\HtmlSanitizer;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Support\Facades\DB;

/**
 * FAQ entries: save (answer sanitized), delete and reorder. New entries go last.
 */
class ManageFaq
{
    public const MAX_ITEMS = 300;

    /** E12b: translatable texts with the limits of their base fields. */
    public const TRANSLATABLE = ['question' => ['max:255'], 'answer_html' => ['max:20000']];

    public function __construct(
        private readonly HtmlSanitizer $sanitizer,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $attributes  validated
     */
    public function save(FaqItem $item, array $attributes): FaqItem
    {
        if (array_key_exists('answer_html', $attributes)) {
            $attributes['answer_html'] = $this->sanitizer->clean((string) $attributes['answer_html']);
            if ($attributes['answer_html'] === '') {
                throw new BusinessRuleViolation('CONTENT_EMPTY', 'The answer has no text left after removing unsupported content.');
            }
        }
        if (array_key_exists('group', $attributes)) {
            $attributes['group'] = $attributes['group'] === null || trim((string) $attributes['group']) === '' ? null : trim((string) $attributes['group']);
        }

        return DB::transaction(function () use ($item, $attributes) {
            $creating = ! $item->exists;
            $before = $creating ? [] : $this->snapshot($item);

            if (array_key_exists('translations', $attributes)) {
                $attributes['translations'] = TranslationInput::apply($item->translations, $attributes['translations'], array_keys(self::TRANSLATABLE), ['answer_html'], $this->sanitizer);
            }
            $item->fill($attributes);
            if ($creating) {
                if (FaqItem::query()->count() >= self::MAX_ITEMS) {
                    throw new BusinessRuleViolation('LIMIT_REACHED', 'The FAQ can have at most '.self::MAX_ITEMS.' entries.');
                }
                $item->sort_order = (int) FaqItem::query()->max('sort_order') + 1;
            }
            $item->save();

            [$old, $new] = Changes::between($before, $this->snapshot($item));
            if ($creating || $new !== []) {
                $this->audit->record($creating ? 'faq_item.created' : 'faq_item.updated', $item, $old, $new);
            }

            return $item;
        });
    }

    public function delete(FaqItem $item): void
    {
        DB::transaction(function () use ($item) {
            $item->delete();
            $this->audit->record('faq_item.deleted', $item, $this->snapshot($item));
        });
    }

    /**
     * @param  list<string>  $ids  every FAQ id, in the new order
     */
    public function reorder(array $ids): void
    {
        DB::transaction(function () use ($ids) {
            $existing = FaqItem::query()->lockForUpdate()->pluck('id')->all();
            if (count($ids) !== count($existing) || array_diff($existing, $ids) !== []) {
                throw new BusinessRuleViolation('ORDER_MISMATCH', 'Send every FAQ entry exactly once. Reload the list and try again.');
            }

            foreach (array_values($ids) as $position => $id) {
                FaqItem::query()->whereKey($id)->update(['sort_order' => $position]);
            }
            $this->audit->record('faq.reordered', null, [], ['ids' => array_values($ids)]);
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(FaqItem $item): array
    {
        return [
            'group' => $item->group,
            'question' => $item->question,
            'answer_hash' => hash('xxh128', $item->answer_html ?? ''),
            'is_active' => $item->is_active,
            'translations_hash' => $item->translations === null ? null : hash('xxh128', (string) json_encode($item->translations)),
        ];
    }
}
