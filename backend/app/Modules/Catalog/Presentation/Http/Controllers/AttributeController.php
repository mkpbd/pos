<?php

namespace App\Modules\Catalog\Presentation\Http\Controllers;

use App\Modules\Catalog\Application\Actions\SaveAttribute;
use App\Modules\Catalog\Infrastructure\Models\Attribute;
use App\Modules\Catalog\Infrastructure\Models\AttributeValue;
use App\Modules\Catalog\Presentation\Http\Requests\SaveAttributeRequest;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;

class AttributeController
{
    /**
     * List attributes
     *
     * The attribute dictionary with ordered values, unpaginated. Readable with `products.view`
     * or `attributes.manage`.
     */
    public function index(): JsonResponse
    {
        return ApiResponse::success(Attribute::query()->with('attributeValues')->orderBy('sort_order')->orderBy('name')->get()
            ->map(fn (Attribute $a) => self::present($a))->all());
    }

    /**
     * Create an attribute
     *
     * `values` in display order. A blank `slug` is derived from the name.
     */
    public function store(SaveAttributeRequest $request, SaveAttribute $save): JsonResponse
    {
        return ApiResponse::created(self::present($save(null, $request->attributeData())));
    }

    /**
     * Update an attribute
     *
     * A sent `values` list replaces the values: entries with `id` keep that value, others are added, missing ones are removed.
     */
    public function update(SaveAttributeRequest $request, Attribute $attribute, SaveAttribute $save): JsonResponse
    {
        return ApiResponse::success(self::present($save($attribute, $request->attributeData())));
    }

    public function destroy(Attribute $attribute, SaveAttribute $save): JsonResponse
    {
        $save->delete($attribute);

        return ApiResponse::noContent();
    }

    /**
     * @return array<string, mixed>
     */
    private static function present(Attribute $a): array
    {
        return [
            'id' => $a->id,
            'name' => $a->name,
            'slug' => $a->slug,
            'display' => $a->display,
            'is_filterable' => $a->is_filterable,
            'sort_order' => $a->sort_order,
            'values' => $a->attributeValues->map(fn (AttributeValue $v) => [
                'id' => $v->id,
                'value' => $v->value,
                'swatch_hex' => $v->swatch_hex,
                'sort_order' => $v->sort_order,
            ])->values()->all(),
        ];
    }
}
