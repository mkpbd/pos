<?php

namespace App\Modules\OnlineCatalog\Presentation\Http\Controllers;

use App\Modules\OnlineCatalog\Application\Ai\WriteCatalogTexts;
use App\Modules\OnlineCatalog\Presentation\Http\Requests\WriteCatalogTextsRequest;
use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * AI2a §1: "Write with AI" in the product, category and brand listing editors.
 */
class CatalogAiWriterController
{
    /**
     * Write listing texts with AI
     *
     * `{subject: product|category|brand, id, fields: [short_description (products only),
     * description, seo_title, seo_description], languages: [en|bn], tone?: friendly|formal|
     * festive|simple, length?: short|medium|long, notes? (≤ 1000)}` → `{subject, id, suggestions:
     * {<lang>: {<field>: text}}, missing_info: [≤ 5], current: {<lang>: {<field>: text|null}}}`.
     * Nothing is saved. `description` is sanitized HTML for products and categories (the
     * listing's description_html) and plain text for brands; `bn` is the Bangla translation of the
     * field. 404 for another store's id; 422 NOTHING_TO_WRITE; 422 AI_UNAVAILABLE
     * (`details.reason`: disabled | budget_exceeded | unavailable | refused | empty | invalid).
     * Counts against the monthly AI budget (feature `catalog_writer`).
     */
    public function __invoke(WriteCatalogTextsRequest $request, WriteCatalogTexts $write): JsonResponse
    {
        return ApiResponse::success($write($request->validated(), StaffActor::id()));
    }
}
