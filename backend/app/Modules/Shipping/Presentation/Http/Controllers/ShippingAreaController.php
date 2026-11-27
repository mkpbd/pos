<?php

namespace App\Modules\Shipping\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Shipping\Application\Actions\ManageShippingAreas;
use App\Modules\Shipping\Infrastructure\Models\ShippingArea;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * BD2a: delivery areas inside a district (thana / upazila) with a fee adjustment. Reading
 * needs `shipping.manage` or `web_orders.view` (staff orders pick an area); changes need
 * `shipping.manage`.
 */
class ShippingAreaController
{
    /**
     * Delivery areas
     *
     * The areas of `district_id` (every district when left out), active or not, in display
     * order: `{id, district_id, name, fee_adjustment, is_active, sort_order}`.
     */
    public function index(Request $request): JsonResponse
    {
        if (! $request->user()->canAny(['shipping.manage', 'web_orders.view'])) {
            throw new AuthorizationException;
        }
        $data = $request->validate(['district_id' => ['sometimes', 'integer', 'min:1', 'max:65535']]);

        return ApiResponse::success(ShippingArea::query()
            ->when(isset($data['district_id']), fn ($q) => $q->where('district_id', (int) $data['district_id']))
            ->orderBy('district_id')->orderBy('sort_order')->orderBy('name')
            ->get()
            ->map(fn (ShippingArea $a) => self::area($a))
            ->values()
            ->all());
    }

    /**
     * Add a delivery area
     *
     * `fee_adjustment` (may be negative) is added to every delivery method's fee in the area;
     * the fee never goes below 0. Names are unique per district, ignoring case.
     */
    public function store(Request $request, ManageShippingAreas $areas): JsonResponse
    {
        return ApiResponse::created(self::area($areas->create($this->data($request, true))));
    }

    /**
     * Change a delivery area
     */
    public function update(Request $request, ShippingArea $area, ManageShippingAreas $areas): JsonResponse
    {
        return ApiResponse::success(self::area($areas->update($area, $this->data($request, false))));
    }

    /**
     * Delete a delivery area
     *
     * Orders keep their copy of the area name.
     */
    public function destroy(ShippingArea $area, ManageShippingAreas $areas): JsonResponse
    {
        $areas->delete($area);

        return ApiResponse::noContent();
    }

    /**
     * @return array<string, mixed>
     */
    private function data(Request $request, bool $creating): array
    {
        $required = $creating ? 'required' : 'sometimes';
        $data = $request->validate([
            'district_id' => [$required, 'integer', 'exists:geo_districts,id'],
            'name' => [$required, 'string', 'max:80', 'regex:/\S/'],
            'fee_adjustment' => ['sometimes', 'nullable', 'numeric', 'min:-99999999', 'max:99999999', 'decimal:0,2'],
            'is_active' => ['sometimes', 'boolean'],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:9999'],
        ]);
        if (array_key_exists('is_active', $data)) {
            $data['is_active'] = $request->boolean('is_active');
        }
        if (array_key_exists('district_id', $data)) {
            $data['district_id'] = (int) $data['district_id'];
        }

        return $data;
    }

    /**
     * @return array{id: string, district_id: int, name: string, fee_adjustment: string, is_active: bool, sort_order: int}
     */
    private static function area(ShippingArea $a): array
    {
        return [
            'id' => $a->id,
            'district_id' => $a->district_id,
            'name' => $a->name,
            'fee_adjustment' => (string) $a->fee_adjustment,
            'is_active' => $a->is_active,
            'sort_order' => $a->sort_order,
        ];
    }
}
