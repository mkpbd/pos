<?php

namespace App\Modules\Catalog\Presentation\Http\Controllers;

use App\Modules\Catalog\Application\Actions\DeleteCatalogRecord;
use App\Modules\Catalog\Application\Actions\SaveCategory;
use App\Modules\Catalog\Infrastructure\Models\Category;
use App\Modules\Catalog\Presentation\Http\Requests\SaveCategoryRequest;
use App\Modules\Catalog\Presentation\Http\Resources\CatalogResource;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CategoryController
{
    /**
     * List categorys
     *
     * Small reference list, returned unpaginated. `?active=1` returns active ones only.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate(['active' => ['sometimes', 'boolean']]);

        return ApiResponse::success(CatalogResource::collection(
            Category::query()
                ->when($request->boolean('active'), fn (Builder $q) => $q->where('is_active', true))
                ->orderBy('sort_order')->orderBy('name')
                ->get()
        ));
    }

    public function store(SaveCategoryRequest $request, SaveCategory $save): JsonResponse
    {
        return ApiResponse::created(new CatalogResource($save(null, $request->validated())));
    }

    public function update(SaveCategoryRequest $request, Category $category, SaveCategory $save): JsonResponse
    {
        return ApiResponse::success(new CatalogResource($save($category, $request->validated())));
    }

    public function destroy(Category $category, DeleteCatalogRecord $delete): JsonResponse
    {
        $delete($category, 'category', 'category');

        return ApiResponse::noContent();
    }
}
