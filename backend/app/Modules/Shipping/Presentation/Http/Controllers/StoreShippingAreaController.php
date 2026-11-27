<?php

namespace App\Modules\Shipping\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Shipping\Application\Contracts\ShippingRates;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class StoreShippingAreaController
{
    /**
     * Delivery areas of a district
     *
     * BD2a: the store's active delivery areas (thana / upazila) of `district_id`, in display
     * order: `[{id, name}]` (`[]` when the district has none — the address keeps a free-text
     * area). When there are areas, checkout needs `address.area_id` to be one of them. Fee
     * adjustments are not shown; the checkout preview gives the final delivery fee.
     */
    public function __invoke(Request $request, ShippingRates $rates): JsonResponse
    {
        $data = $request->validate(['district_id' => ['required', 'integer', 'min:1', 'max:65535']]);

        return ApiResponse::success(array_map(
            fn (array $area) => ['id' => $area['id'], 'name' => $area['name']],
            $rates->areas((int) $data['district_id']),
        ));
    }
}
