<?php

namespace App\Modules\OnlineCatalog\Presentation\Http\Controllers;

use App\Modules\OnlineCatalog\Application\Actions\SaveBrandListing;
use App\Modules\OnlineCatalog\Application\Actions\SaveCategoryListing;
use App\Modules\OnlineCatalog\Application\Queries\ListingEditor;
use App\Modules\OnlineCatalog\Presentation\Http\Requests\SaveBrandListingRequest;
use App\Modules\OnlineCatalog\Presentation\Http\Requests\SaveCategoryListingRequest;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * Web listings of categories and brands (admin).
 */
class TaxonomyListingController
{
    /**
     * Category web listings
     *
     * Every catalog category in tree order (`depth`), with its listing or null.
     */
    public function categories(ListingEditor $editor): JsonResponse
    {
        return ApiResponse::success($editor->categories());
    }

    public function category(string $categoryId, ListingEditor $editor): JsonResponse
    {
        return ApiResponse::success($editor->category($categoryId));
    }

    /**
     * Save a category web listing
     *
     * Images must exist in the media library (`MEDIA_NOT_FOUND`); the description is sanitized.
     */
    public function updateCategory(SaveCategoryListingRequest $request, string $categoryId, SaveCategoryListing $save, ListingEditor $editor): JsonResponse
    {
        $save($categoryId, $request->validated());

        return ApiResponse::success($editor->category($categoryId));
    }

    /**
     * Brand web listings
     *
     * Every brand by name, with its listing or null.
     */
    public function brands(ListingEditor $editor): JsonResponse
    {
        return ApiResponse::success($editor->brands());
    }

    public function brand(string $brandId, ListingEditor $editor): JsonResponse
    {
        return ApiResponse::success($editor->brand($brandId));
    }

    /**
     * Save a brand web listing
     *
     * The logo must exist in the media library (`MEDIA_NOT_FOUND`).
     */
    public function updateBrand(SaveBrandListingRequest $request, string $brandId, SaveBrandListing $save, ListingEditor $editor): JsonResponse
    {
        $save($brandId, $request->validated());

        return ApiResponse::success($editor->brand($brandId));
    }
}
