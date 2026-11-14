<?php

namespace App\Modules\Reviews\Presentation\Http\Controllers;

use App\Modules\Reviews\Application\Actions\ModerateProductQuestion;
use App\Modules\Reviews\Application\Queries\ProductQuestionQueries;
use App\Modules\Reviews\Domain\QuestionStatus;
use App\Modules\Reviews\Infrastructure\Models\ProductQuestion;
use App\Modules\Reviews\Presentation\Http\Support\Pagination;
use App\Modules\Reviews\Presentation\Http\Support\QuestionPresenter;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * P1b: staff answers to shoppers' questions — listing needs `reviews.view`; answering,
 * rejecting and deleting need `reviews.moderate`.
 */
class QuestionModerationController
{
    public function __construct(
        private readonly QuestionPresenter $presenter,
        private readonly ModerateProductQuestion $moderate,
    ) {}

    /**
     * Product questions
     *
     * Filters: `status` (pending|published|rejected), `search` (question, answer, asker's name or
     * e-mail, product name), `product` (product id). Pending first, then newest; `per_page` up to
     * 100 (default 25). Rows `{id, product: {id, name, slug}, name, email, question, answer,
     * status, locale, created_at, answered_at, answered_by_name}`; `meta.pending_count` counts all
     * pending questions.
     */
    public function index(Request $request, ProductQuestionQueries $queries): JsonResponse
    {
        $data = $request->validate([
            'status' => ['sometimes', 'nullable', Rule::enum(QuestionStatus::class)],
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
            'product' => ['sometimes', 'nullable', 'uuid'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1'],
        ]);
        $perPage = max(1, min(ListQuery::MAX_PER_PAGE, (int) ($data['per_page'] ?? 25)));
        $page = $queries->forStaff([
            'status' => $data['status'] ?? null,
            'search' => $data['search'] ?? null,
            'product' => isset($data['product']) ? strtolower((string) $data['product']) : null,
        ], (int) ($data['page'] ?? 1), $perPage);

        return ApiResponse::success($this->presenter->staff($page->items()), meta: [
            'pagination' => Pagination::meta($page),
            'pending_count' => $queries->pendingCount(),
        ]);
    }

    /**
     * Answer a question
     *
     * `{answer (1–2000 characters), publish}`. `publish: true` shows the question and its answer
     * on the product page (the asker gets one e-mail the first time); `false` saves the answer and
     * keeps the question hidden (pending). Saving the same answer and state again changes nothing.
     */
    public function answer(Request $request, ProductQuestion $question): JsonResponse
    {
        $data = $request->validate([
            'answer' => ['required', 'string', 'max:2000'],
            'publish' => ['required', 'boolean'],
        ]);

        return $this->row($this->moderate->answer($question, (string) $data['answer'], (bool) $data['publish'], (string) $request->user()->getAuthIdentifier()));
    }

    /**
     * Reject a question
     *
     * Hidden from the product page. Rejecting a rejected question changes nothing.
     */
    public function reject(ProductQuestion $question): JsonResponse
    {
        return $this->row($this->moderate->reject($question));
    }

    /**
     * Delete a question
     */
    public function destroy(ProductQuestion $question): JsonResponse
    {
        $this->moderate->delete($question);

        return ApiResponse::noContent();
    }

    private function row(ProductQuestion $question): JsonResponse
    {
        return ApiResponse::success($this->presenter->staff([$question->fresh() ?? $question])[0]);
    }
}
