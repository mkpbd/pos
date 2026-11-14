<?php

namespace App\Modules\OnlineCatalog\Presentation\Http\Controllers;

use App\Modules\OnlineCatalog\Application\Actions\RequestBackInStock;
use App\Modules\OnlineCatalog\Application\Queries\BackInStockRequests;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * P1a: "Notify me when it's back" (public) and the staff list of requests.
 */
class BackInStockController
{
    /**
     * Ask to be told when a variant is back
     *
     * 202 for valid input, whether the request is new or already open. 422 `variant_id` when it
     * is not an active variant of this live product. `website` is a honeypot. Limited per visitor.
     */
    public function store(Request $request, string $slug, RequestBackInStock $notify, LocaleContext $locale): JsonResponse
    {
        $data = $request->validate([
            'variant_id' => ['required', 'uuid'],
            'email' => ['required', 'email:rfc', 'max:254'],
            'website' => ['nullable', 'string', 'max:255'],
        ]);
        $notify($slug, $data, $request->user('customer')?->getAuthIdentifier(), $locale->current(), $request->getSchemeAndHttpHost());

        $message = $locale->current() === LocaleContext::BN
            ? 'ধন্যবাদ! পণ্যটি আবার স্টকে এলে আমরা আপনাকে একবার ই-মেইল করব।'
            : 'Thanks! We will e-mail you once when it is back in stock.';

        return ApiResponse::success(['message' => $message], 202);
    }

    /**
     * Back-in-stock requests of a product
     *
     * Newest first; `status=open|notified` filters.
     */
    public function index(Request $request, string $productId, BackInStockRequests $requests): JsonResponse
    {
        $request->validate(['status' => ['sometimes', 'in:open,notified']]);
        $result = $requests->forProduct($productId, $request->query('status'), ListQuery::perPage($request));

        return ApiResponse::paginated($result['page'], fn ($r) => new JsonResource(($result['row'])($r)));
    }
}
