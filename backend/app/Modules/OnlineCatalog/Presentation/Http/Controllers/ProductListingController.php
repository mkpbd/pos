<?php

namespace App\Modules\OnlineCatalog\Presentation\Http\Controllers;

use App\Modules\OnlineCatalog\Application\Actions\SaveProductListing;
use App\Modules\OnlineCatalog\Application\Actions\SaveRelatedProducts;
use App\Modules\OnlineCatalog\Application\Queries\ListingEditor;
use App\Modules\OnlineCatalog\Infrastructure\Models\RelatedProduct;
use App\Modules\OnlineCatalog\Presentation\Http\Requests\SaveProductListingRequest;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProductListingController
{
    /**
     * Product web listing
     *
     * The product (variants with prices, images), its listing (or suggested defaults with
     * `exists: false`), per-variant compare-at prices and images, related products and the
     * storefront address.
     */
    public function show(string $productId, ListingEditor $editor): JsonResponse
    {
        return ApiResponse::success($editor->product($productId));
    }

    /**
     * Save a product web listing
     *
     * Upserts the listing and the named variants' web data. `COMPARE_AT_NOT_ABOVE_PRICE` when a
     * compare-at price is not above the selling price; `PRODUCT_NOT_SELLABLE` when publishing an
     * inactive product. A blank slug keeps the current one (or a free suggestion).
     */
    public function update(SaveProductListingRequest $request, string $productId, SaveProductListing $save, ListingEditor $editor): JsonResponse
    {
        $save($productId, $request->listingData());

        return ApiResponse::success($editor->product($productId));
    }

    /**
     * Replace related products
     *
     * Ordered lists of product ids, at most 12 each; not the product itself (`PRODUCT_NOT_FOUND`
     * for ids of other organizations or archived products).
     */
    public function updateRelated(Request $request, string $productId, SaveRelatedProducts $save, ListingEditor $editor): JsonResponse
    {
        $max = RelatedProduct::MAX_PER_KIND;
        $data = $request->validate([
            'related' => ['present', 'array', "max:{$max}"],
            'related.*' => ['uuid', 'distinct'],
            'frequently_bought' => ['present', 'array', "max:{$max}"],
            'frequently_bought.*' => ['uuid', 'distinct'],
        ]);
        $save($productId, array_map(array_values(...), $data));

        return ApiResponse::success($editor->product($productId));
    }
}
