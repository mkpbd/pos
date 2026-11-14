<?php

namespace App\Modules\OnlineCatalog\Presentation\Http\Controllers;

use App\Modules\OnlineCatalog\Application\Actions\ManageSizeGuides;
use App\Modules\OnlineCatalog\Application\Queries\SizeGuides;
use App\Modules\OnlineCatalog\Infrastructure\Models\SizeGuide;
use App\Modules\OnlineCatalog\Presentation\Http\Requests\SaveSizeGuideRequest;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * P1a: size guides of the online store.
 */
class SizeGuideController
{
    /**
     * List size guides
     *
     * By name, with their categories and the number of products that name them directly.
     */
    public function index(SizeGuides $guides): JsonResponse
    {
        return ApiResponse::success($guides->list());
    }

    public function show(string $sizeGuideId, SizeGuides $guides): JsonResponse
    {
        return ApiResponse::success($guides->show(SizeGuide::query()->findOrFail($sizeGuideId)));
    }

    /**
     * Create a size guide
     *
     * ≤ 12 columns × 40 rows; cell keys are column ids. A category can use only one guide
     * (422 `category_ids.N` naming the other guide).
     */
    public function store(SaveSizeGuideRequest $request, ManageSizeGuides $manage, SizeGuides $guides): JsonResponse
    {
        return ApiResponse::created($guides->show($manage->save(null, $request->guideData())));
    }

    public function update(SaveSizeGuideRequest $request, string $sizeGuideId, ManageSizeGuides $manage, SizeGuides $guides): JsonResponse
    {
        $guide = SizeGuide::query()->findOrFail($sizeGuideId);

        return ApiResponse::success($guides->show($manage->save($guide, $request->guideData())));
    }

    /**
     * Delete a size guide
     *
     * Its categories lose it; products that named it fall back to their category's guide.
     */
    public function destroy(string $sizeGuideId, ManageSizeGuides $manage): JsonResponse
    {
        $manage->delete(SizeGuide::query()->findOrFail($sizeGuideId));

        return ApiResponse::noContent();
    }
}
