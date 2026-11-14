<?php

namespace App\Modules\Reviews\Presentation\Http\Controllers;

use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Reviews\Application\Actions\AskProductQuestion;
use App\Modules\Reviews\Application\Queries\ProductQuestionQueries;
use App\Modules\Reviews\Presentation\Http\Support\Pagination;
use App\Modules\Reviews\Presentation\Http\Support\QuestionPresenter;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * P1b: shoppers' questions about a live product (public).
 */
class StoreQuestionController
{
    /**
     * Product questions
     *
     * Answered, published questions, 10 per page, latest answer first: `{id, name (the asker's
     * first name + last initial), question, answer, asked_at, answered_at}`; `meta.pagination`.
     * Unknown or not-live product: 404.
     */
    public function index(Request $request, string $slug, StorefrontCatalog $catalog, ProductQuestionQueries $queries, QuestionPresenter $presenter): JsonResponse
    {
        $data = $request->validate(['page' => ['sometimes', 'integer', 'min:1']]);
        $productId = $catalog->liveProductId($slug) ?? throw new NotFoundHttpException;
        $page = $queries->publishedOf($productId, (int) ($data['page'] ?? 1));

        return ApiResponse::success($presenter->public($page->items()), meta: ['pagination' => Pagination::meta($page)]);
    }

    /**
     * Ask a question
     *
     * `{name (≤ 80), email, question (5–500), website (honeypot, leave empty)}`. Guests may ask;
     * a signed-in shopper's account is linked. 202 with a thank-you `message` (in the request's
     * language) for every valid request — the question shows once staff answer and publish it.
     * Unknown or not-live product: 404. Limited per visitor (429).
     */
    public function store(Request $request, string $slug, StorefrontCatalog $catalog, AskProductQuestion $ask, LocaleContext $locale): JsonResponse
    {
        $productId = $catalog->liveProductId($slug) ?? throw new NotFoundHttpException;
        $data = $request->validate([
            'name' => ['required', 'string', 'max:80'],
            'email' => ['required', 'email:rfc', 'max:254'],
            'question' => ['required', 'string', 'min:5', 'max:500'],
            'website' => ['nullable', 'string', 'max:255'],
        ]);
        $ask($productId, $data, $request->user('customer')?->getAuthIdentifier(), $locale->current(), $request->getSchemeAndHttpHost());

        $message = $locale->current() === LocaleContext::BN
            ? 'ধন্যবাদ — উত্তর দেওয়ার পর আপনার প্রশ্নটি এখানে দেখা যাবে।'
            : 'Thanks — your question will appear once we answer it.';

        return ApiResponse::success(['message' => $message], 202);
    }
}
