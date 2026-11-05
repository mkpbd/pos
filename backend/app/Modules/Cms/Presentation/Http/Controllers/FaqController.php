<?php

namespace App\Modules\Cms\Presentation\Http\Controllers;

use App\Modules\Cms\Application\Actions\ManageFaq;
use App\Modules\Cms\Infrastructure\Models\FaqItem;
use App\Modules\Cms\Presentation\Http\Support\CmsPresenter;
use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FaqController
{
    /**
     * List FAQ entries
     *
     * All entries (inactive included) in display order.
     */
    public function index(): JsonResponse
    {
        return ApiResponse::success(FaqItem::query()->orderBy('sort_order')->get()->map(fn (FaqItem $f) => CmsPresenter::faqItem($f))->all());
    }

    public function store(Request $request, ManageFaq $faq): JsonResponse
    {
        return ApiResponse::created(CmsPresenter::faqItem($faq->save(new FaqItem, $request->validate($this->rules(true)))));
    }

    public function update(Request $request, FaqItem $faqItem, ManageFaq $faq): JsonResponse
    {
        return ApiResponse::success(CmsPresenter::faqItem($faq->save($faqItem, $request->validate($this->rules(false)))));
    }

    public function destroy(FaqItem $faqItem, ManageFaq $faq): JsonResponse
    {
        $faq->delete($faqItem);

        return ApiResponse::noContent();
    }

    /**
     * Reorder the FAQ
     *
     * Every entry id exactly once, in the new order.
     */
    public function reorder(Request $request, ManageFaq $faq): JsonResponse
    {
        $data = $request->validate(['ids' => ['present', 'array', 'max:'.ManageFaq::MAX_ITEMS], 'ids.*' => ['uuid', 'distinct']]);
        $faq->reorder($data['ids']);

        return $this->index();
    }

    /**
     * @return array<string, mixed>
     */
    private function rules(bool $creating): array
    {
        $required = $creating ? 'required' : 'sometimes';

        return [
            'group' => ['sometimes', 'nullable', 'string', 'max:80'],
            'question' => [$required, 'string', 'max:255'],
            'answer_html' => [$required, 'string', 'max:20000'],
            'is_active' => ['sometimes', 'boolean'],
            // E12b: {bn: {question, answer_html}} (partial; blank removes).
            ...TranslationInput::rules(ManageFaq::TRANSLATABLE),
        ];
    }
}
