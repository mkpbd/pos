<?php

namespace App\Modules\Catalog\Presentation\Http\Controllers;

use App\Modules\Catalog\Application\Actions\DeleteCatalogRecord;
use App\Modules\Catalog\Application\Actions\SaveUnit;
use App\Modules\Catalog\Infrastructure\Models\Unit;
use App\Modules\Catalog\Presentation\Http\Requests\SaveUnitRequest;
use App\Modules\Catalog\Presentation\Http\Resources\CatalogResource;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class UnitController
{
    /**
     * List units
     *
     * Small reference list, returned unpaginated. `?active=1` returns active ones only.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate(['active' => ['sometimes', 'boolean']]);

        return ApiResponse::success(CatalogResource::collection(
            Unit::query()
                ->when($request->boolean('active'), fn (Builder $q) => $q->where('is_active', true))
                ->orderBy('name')
                ->get()
        ));
    }

    public function store(SaveUnitRequest $request, SaveUnit $save): JsonResponse
    {
        return ApiResponse::created(new CatalogResource($save(null, $request->validated())));
    }

    public function update(SaveUnitRequest $request, Unit $unit, SaveUnit $save): JsonResponse
    {
        return ApiResponse::success(new CatalogResource($save($unit, $request->validated())));
    }

    public function destroy(Unit $unit, DeleteCatalogRecord $delete): JsonResponse
    {
        $delete($unit, 'unit', 'unit');

        return ApiResponse::noContent();
    }
}
