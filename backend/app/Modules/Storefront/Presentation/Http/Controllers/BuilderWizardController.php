<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Builder\Wizard\BuildPageWizard;
use App\Modules\Storefront\Domain\Builder\Wizard\WizardOptions;
use App\Modules\Storefront\Domain\Festivals\FestivalCalendar;
use App\Modules\Storefront\Presentation\Http\Support\BuilderPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * B21: "Build my page in 1 minute" — the store builder's page wizard.
 */
class BuilderWizardController
{
    /**
     * Build a page with the wizard
     *
     * `{page_type: home|sale|product_launch|about|festival|contact, title (1–80), slug? (2–60
     * lower-case letters, digits and dashes, not "home"; landing pages), goal: orders|order_form|
     * phone_numbers|show_collection|tell_story, look: current|calm|lively|festive, language:
     * en|bn|both, use_ai?: bool, category_ids?: uuid[] (≤ 4, visible categories), product_ids?:
     * uuid[] (≤ 8, live products), festival?: occasion key (festival pages; default the next
     * occasion)}` → 201 `{document: <document summary>, target: home|landing, sections:
     * [{template, label, label_bn}], products: {source: chosen|category|best_sellers|
     * new_arrivals|none, count}, festival: {key, name, name_bn}|null, ai: {used, status:
     * not_requested|ok|disabled|budget_exceeded|failed}}`. The page is made from the built-in
     * templates of the page type and goal, filled with the store's facts and the built-in English
     * / Bangla texts (rewritten by AI from store facts only when `use_ai` and AI is on — AI off or
     * failing keeps the built-in texts) and saved as a **draft** only: a home page goes into the
     * builder home while that has no content (never published), else — like every other page type —
     * into a new landing page (address from the title when no slug is given, -2, -3… when taken).
     * 422 VALIDATION_FAILED (unknown or another organization's categories / products), 422
     * NOTHING_TO_SHOW (`details.reason` no_live_products: the page shows products and none is on
     * sale online), 409 DOCUMENT_EXISTS (the chosen address is taken), 423 DOCUMENT_LOCKED (the empty
     * home page is being edited by someone else). Audited (`storefront.builder_wizard`).
     */
    public function __invoke(Request $request, BuildPageWizard $wizard): JsonResponse
    {
        $data = $request->validate([
            'page_type' => ['required', Rule::in(WizardOptions::PAGE_TYPES)],
            'title' => ['required', 'string', 'max:'.WizardOptions::MAX_TITLE, 'regex:/\S/u'],
            'slug' => ['sometimes', 'nullable', 'string', 'regex:'.WizardOptions::SLUG_PATTERN, 'not_in:home'],
            'goal' => ['required', Rule::in(WizardOptions::GOALS)],
            'look' => ['required', Rule::in(WizardOptions::LOOKS)],
            'language' => ['required', Rule::in(WizardOptions::LANGUAGES)],
            'use_ai' => ['sometimes', 'boolean'],
            'category_ids' => ['sometimes', 'array', 'max:'.WizardOptions::MAX_CATEGORIES],
            'category_ids.*' => ['uuid', 'distinct'],
            'product_ids' => ['sometimes', 'array', 'max:'.WizardOptions::MAX_PRODUCTS],
            'product_ids.*' => ['uuid', 'distinct'],
            'festival' => ['sometimes', 'nullable', Rule::in(array_keys(FestivalCalendar::OCCASIONS))],
        ], [
            'slug.regex' => 'Use 2–60 lower-case letters, digits and dashes.',
            'slug.not_in' => 'The address "home" is reserved for the home page.',
            'title.regex' => 'Give the page a title.',
        ]);
        $data['use_ai'] = (bool) ($data['use_ai'] ?? false);
        $result = $wizard($data, StaffActor::id());

        return ApiResponse::created([
            'document' => BuilderPresenter::summary($result['document']->load('publishedVersion')),
        ] + array_diff_key($result, ['document' => true]));
    }
}
