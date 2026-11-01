<?php

namespace App\Modules\Reviews\Presentation\Http\Controllers;

use App\Modules\Reviews\Application\Actions\ModerateReview;
use App\Modules\Reviews\Application\Queries\ReviewQueries;
use App\Modules\Reviews\Domain\ReviewStatus;
use App\Modules\Reviews\Infrastructure\Models\Review;
use App\Modules\Reviews\Presentation\Http\Support\Pagination;
use App\Modules\Reviews\Presentation\Http\Support\ReviewPresenter;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Staff moderation of product reviews (E9): listing needs `reviews.view`, approve / reject /
 * delete need `reviews.moderate`.
 */
class ReviewModerationController
{
    public function __construct(
        private readonly ReviewPresenter $presenter,
        private readonly ModerateReview $moderate,
    ) {}

    /**
     * Reviews
     *
     * Filters: `status` (pending|approved|rejected), `rating` (1-5), `search` (title, body,
     * product name, customer name or e-mail). Pending first, then newest; `per_page` up to
     * 100 (default 25). Rows `{id, product: {id, name}, customer: {id, name, email}, rating,
     * title, body, status, created_at, moderated_at, moderated_by_name, rejection_reason}`;
     * `meta.pending_count` counts all pending reviews.
     */
    public function index(Request $request, ReviewQueries $queries): JsonResponse
    {
        $data = $request->validate([
            'status' => ['sometimes', 'nullable', Rule::enum(ReviewStatus::class)],
            'rating' => ['sometimes', 'nullable', 'integer', 'between:1,5'],
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1'],
        ]);
        $perPage = max(1, min(ListQuery::MAX_PER_PAGE, (int) ($data['per_page'] ?? 25)));
        $page = $queries->forStaff([
            'status' => $data['status'] ?? null,
            'rating' => isset($data['rating']) ? (int) $data['rating'] : null,
            'search' => $data['search'] ?? null,
        ], (int) ($data['page'] ?? 1), $perPage);

        return ApiResponse::success($this->presenter->staff($page->items()), meta: [
            'pagination' => Pagination::meta($page),
            'pending_count' => $queries->pendingCount(),
        ]);
    }

    /**
     * Approve a review
     *
     * Shown on the product page from now on. Approving an approved review changes nothing.
     */
    public function approve(Request $request, Review $review): JsonResponse
    {
        return $this->row($this->moderate->approve($review, (string) $request->user()->getAuthIdentifier()));
    }

    /**
     * Reject a review
     *
     * `{reason?}` (at most 200 characters), shown to the author. Rejecting a rejected review
     * changes nothing.
     */
    public function reject(Request $request, Review $review): JsonResponse
    {
        $data = $request->validate(['reason' => ['sometimes', 'nullable', 'string', 'max:200']]);
        $reason = filled($data['reason'] ?? null) ? trim($data['reason']) : null;

        return $this->row($this->moderate->reject($review, $reason, (string) $request->user()->getAuthIdentifier()));
    }

    /**
     * Delete a review
     */
    public function destroy(Review $review): JsonResponse
    {
        $this->moderate->delete($review);

        return ApiResponse::noContent();
    }

    private function row(Review $review): JsonResponse
    {
        return ApiResponse::success($this->presenter->staff([$review->fresh() ?? $review])[0]);
    }
}
