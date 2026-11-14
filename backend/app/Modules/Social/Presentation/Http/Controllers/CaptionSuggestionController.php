<?php

namespace App\Modules\Social\Presentation\Http\Controllers;

use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Social\Application\Actions\SuggestCaptions;
use App\Modules\Social\Domain\CaptionTemplates;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * P2b: caption ideas for a product.
 */
class CaptionSuggestionController
{
    /**
     * Caption suggestions
     *
     * `{product_id, language?: en|bn, tone?: friendly|festive|short}` → `{captions: [3 strings],
     * source: ai|template, reason: null|disabled|unavailable|budget_exceeded|invalid_output}`. AI
     * when it is on (counts against the monthly AI budget), else template captions. The product
     * must be listed in the online store (422 `product_id`).
     */
    public function __invoke(Request $request, SuggestCaptions $suggest): JsonResponse
    {
        $data = $request->validate([
            'product_id' => ['required', 'uuid'],
            'language' => ['sometimes', Rule::in(CaptionTemplates::LANGUAGES)],
            'tone' => ['sometimes', Rule::in(CaptionTemplates::TONES)],
        ]);

        return ApiResponse::success($suggest($data['product_id'], $data['language'] ?? 'en', $data['tone'] ?? 'friendly', StaffActor::id()));
    }
}
