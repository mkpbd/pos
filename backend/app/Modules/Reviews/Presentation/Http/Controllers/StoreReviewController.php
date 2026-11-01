<?php

namespace App\Modules\Reviews\Presentation\Http\Controllers;

use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Reviews\Application\Queries\ReviewQueries;
use App\Modules\Reviews\Presentation\Http\Support\Pagination;
use App\Modules\Reviews\Presentation\Http\Support\ReviewPresenter;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Public reviews of a live product (E9).
 */
class StoreReviewController
{
    /**
     * Product reviews
     *
     * Approved reviews only, 10 per page. `sort`: newest (default), highest, lowest;
     * `rating`: 1-5. Rows `{id, rating, title, body, author (first name + last initial),
     * created_at, verified: true}`; next to `data`, `summary` `{average (one decimal, null
     * without reviews), count, distribution: {"1": n, ..., "5": n}}` over all approved
     * reviews (not filtered by `rating`). Unknown or not-live product: 404.
     */
    public function index(Request $request, string $slug, StorefrontCatalog $catalog, ReviewQueries $queries, ReviewPresenter $presenter): JsonResponse
    {
        $data = $request->validate([
            'sort' => ['sometimes', Rule::in(ReviewQueries::SORTS)],
            'rating' => ['sometimes', 'nullable', 'integer', 'between:1,5'],
            'page' => ['sometimes', 'integer', 'min:1'],
        ]);
        $productId = $catalog->liveProductId($slug) ?? throw new NotFoundHttpException;

        $page = $queries->approvedOf($productId, $data['sort'] ?? 'newest', isset($data['rating']) ? (int) $data['rating'] : null, (int) ($data['page'] ?? 1));
        $response = ApiResponse::success($presenter->public($page->items()), meta: ['pagination' => Pagination::meta($page)]);
        $payload = $response->getData(true);
        $payload['summary'] = $queries->summary($productId);

        return $response->setData($payload);
    }
}
