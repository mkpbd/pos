<?php

namespace App\Modules\Catalog\Presentation\Http\Controllers;

use App\Modules\Catalog\Application\Actions\DeleteCatalogRecord;
use App\Modules\Catalog\Application\Actions\SaveCatalogRecord;
use App\Modules\Catalog\Infrastructure\Models\TaxRate;
use App\Modules\Catalog\Presentation\Http\Requests\SaveTaxRateRequest;
use App\Modules\Catalog\Presentation\Http\Resources\CatalogResource;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TaxRateController
{
    /**
     * List tax rates
     *
     * Small reference list, returned unpaginated. `?active=1` returns active ones only.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate(['active' => ['sometimes', 'boolean']]);

        return ApiResponse::success(CatalogResource::collection(
            TaxRate::query()
                ->when($request->boolean('active'), fn (Builder $q) => $q->where('is_active', true))
                ->orderBy('name')
                ->get()
        ));
    }

    public function store(SaveTaxRateRequest $request, SaveCatalogRecord $save): JsonResponse
    {
        return ApiResponse::created(new CatalogResource($save(new TaxRate, $request->validated(), 'tax_rate')));
    }

    public function update(SaveTaxRateRequest $request, TaxRate $taxRate, SaveCatalogRecord $save): JsonResponse
    {
        return ApiResponse::success(new CatalogResource($save($taxRate, $request->validated(), 'tax_rate')));
    }

    public function destroy(TaxRate $taxRate, DeleteCatalogRecord $delete): JsonResponse
    {
        $delete($taxRate, 'tax_rate', 'tax rate');

        return ApiResponse::noContent();
    }
}
