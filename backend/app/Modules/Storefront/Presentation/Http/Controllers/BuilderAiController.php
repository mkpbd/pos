<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Builder\WriteBuilderTexts;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * B9: the store builder's AI writer.
 */
class BuilderAiController
{
    /**
     * Write texts with AI
     *
     * `{mode: element|section|translate, document_id, node_id, type?, instruction? (≤ 500),
     * language: en|bn, tone?: friendly|formal|festive|short (default friendly), current?}` →
     * `{source: "ai", mode, language, target: base|translations.bn, texts: {<field>: text},
     * elements: {<element id>: {<field>: text}}}`. Nothing is saved. `element`: the element's
     * translatable fields (`current` = `{<field>: text}`, unsaved texts; `type` for an element not
     * saved yet); `section`: every element of a section of the saved draft (≤ 40 fields; `current`
     * = `{<element id>: {<field>: text}}`); `translate`: Bangla (language bn) or English (en)
     * versions of the texts. 422 AI_UNAVAILABLE (`details.reason`: disabled | budget_exceeded |
     * failed | refused), NODE_NOT_FOUND, NO_TEXT_FIELDS, TOO_MANY_FIELDS (`details.limit`); 20
     * requests per minute per user. Counts against the monthly AI budget.
     */
    public function __invoke(Request $request, WriteBuilderTexts $write): JsonResponse
    {
        $data = $request->validate([
            'mode' => ['required', Rule::in(WriteBuilderTexts::MODES)],
            'document_id' => ['required', 'uuid'],
            'node_id' => ['required', 'string', 'regex:/'.BuilderDocumentSchema::ID_PATTERN.'/'],
            'type' => ['sometimes', 'nullable', 'string', 'max:40'],
            'instruction' => ['sometimes', 'nullable', 'string', 'max:'.WriteBuilderTexts::MAX_INSTRUCTION],
            'language' => ['required', Rule::in(WriteBuilderTexts::LANGUAGES)],
            'tone' => ['sometimes', Rule::in(WriteBuilderTexts::TONES)],
            'current' => ['sometimes', 'nullable', 'array'],
        ]);
        $document = BuilderDocument::query()->builder()->findOrFail(strtolower($data['document_id']));

        return ApiResponse::success($write($document, $data + ['tone' => 'friendly'], StaffActor::id()));
    }
}
