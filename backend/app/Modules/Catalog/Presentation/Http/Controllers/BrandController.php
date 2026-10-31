<?php

namespace App\Modules\Catalog\Presentation\Http\Controllers;

use App\Modules\Catalog\Application\Actions\DeleteCatalogRecord;
use App\Modules\Catalog\Application\Actions\SaveCatalogRecord;
use App\Modules\Catalog\Infrastructure\Models\Brand;
use App\Modules\Catalog\Presentation\Http\Requests\SaveBrandRequest;
use App\Modules\Catalog\Presentation\Http\Resources\CatalogResource;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BrandController
{
    /**
     * List brands
     *
     * Small reference list, returned unpaginated. `?active=1` returns active ones only.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate(['active' => ['sometimes', 'boolean']]);

        return ApiResponse::success(CatalogResource::collection(
            Brand::query()
                ->when($request->boolean('active'), fn (Builder $q) => $q->where('is_active', true))
                ->orderBy('name')
                ->get()
        ));
    }

    public function store(SaveBrandRequest $request, SaveCatalogRecord $save): JsonResponse
    {
        return ApiResponse::created(new CatalogResource($save(new Brand, $request->validated(), 'brand')));
    }

    public function update(SaveBrandRequest $request, Brand $brand, SaveCatalogRecord $save): JsonResponse
    {
        return ApiResponse::success(new CatalogResource($save($brand, $request->validated(), 'brand')));
    }

    public function destroy(Brand $brand, DeleteCatalogRecord $delete): JsonResponse
    {
        $delete($brand, 'brand', 'brand');

        return ApiResponse::noContent();
    }
}
