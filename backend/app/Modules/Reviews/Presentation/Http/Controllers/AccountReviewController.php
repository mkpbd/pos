<?php

namespace App\Modules\Reviews\Presentation\Http\Controllers;

use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\Reviews\Application\Actions\CustomerReviews;
use App\Modules\Reviews\Application\Queries\ReviewQueries;
use App\Modules\Reviews\Presentation\Http\Support\Pagination;
use App\Modules\Reviews\Presentation\Http\Support\ReviewPresenter;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The signed-in customer's own reviews (E9). Another customer's review id is 404.
 */
class AccountReviewController
{
    private const TITLE = ['nullable', 'string', 'max:120'];

    private const BODY = ['string', 'min:10', 'max:2000'];

    public function __construct(
        private readonly CustomerReviews $reviews,
        private readonly ReviewPresenter $presenter,
    ) {}

    /**
     * My reviews
     *
     * Newest first, 20 per page: `{id, product: {id, name, slug (null while not live),
     * image_url}, rating, title, body, status (pending|approved|rejected), status_label,
     * rejection_reason, verified, created_at, updated_at}`.
     */
    public function index(Request $request, ReviewQueries $queries): JsonResponse
    {
        $data = $request->validate(['page' => ['sometimes', 'integer', 'min:1']]);
        $page = $queries->ofCustomer($this->customerId($request), (int) ($data['page'] ?? 1));

        return ApiResponse::success($this->presenter->own($page->items()), meta: ['pagination' => Pagination::meta($page)])->header('Cache-Control', 'no-store');
    }

    /**
     * Write a review
     *
     * `{product_id, rating (1-5), title? (at most 120), body (10-2000 characters, plain
     * text)}`. Needs a delivered order with the product: 422 `REVIEW_NOT_ALLOWED`; one review
     * per product: 422 `REVIEW_EXISTS` (`details.review_id`). Starts `pending` until staff
     * approve it. Rate limit `reviews` (5 per hour per customer).
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'product_id' => ['required', 'uuid'],
            'rating' => ['required', 'integer', 'between:1,5'],
            'title' => ['sometimes', ...self::TITLE],
            'body' => ['required', ...self::BODY],
        ]);
        $review = $this->reviews->submit($this->customerId($request), $data);

        return ApiResponse::created($this->presenter->own([$review])[0]);
    }

    /**
     * Edit my review
     *
     * Any subset of rating, title, body (any status); the review goes back to `pending`.
     */
    public function update(Request $request, string $reviewId): JsonResponse
    {
        $data = $request->validate([
            'rating' => ['sometimes', 'integer', 'between:1,5'],
            'title' => ['sometimes', ...self::TITLE],
            'body' => ['sometimes', 'required', ...self::BODY],
        ]);
        $review = $this->reviews->update($this->customerId($request), $reviewId, $data);

        return ApiResponse::success($this->presenter->own([$review])[0]);
    }

    /**
     * Delete my review
     */
    public function destroy(Request $request, string $reviewId): JsonResponse
    {
        $this->reviews->delete($this->customerId($request), $reviewId);

        return ApiResponse::noContent();
    }

    private function customerId(Request $request): string
    {
        /** @var CustomerAccount $account */
        $account = $request->user('customer');

        return $account->customer_id;
    }
}
