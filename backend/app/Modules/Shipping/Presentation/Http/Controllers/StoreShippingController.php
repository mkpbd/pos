<?php

namespace App\Modules\Shipping\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Shipping\Application\Contracts\ShippingRates;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class StoreShippingController
{
    /**
     * Delivery methods for a district
     *
     * The active methods of the active zone covering `district_id` (`[]` when none):
     * `{id, name, description, fee, free_over, cod_allowed, cod_fee, eta_min_days, eta_max_days}`.
     */
    public function __invoke(Request $request, ShippingRates $rates): JsonResponse
    {
        $data = $request->validate(['district_id' => ['required', 'integer', 'min:1', 'max:65535']]);

        return ApiResponse::success($rates->methodsForDistrict((int) $data['district_id']));
    }
}
