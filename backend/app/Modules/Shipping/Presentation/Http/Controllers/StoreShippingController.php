<?php

namespace App\Modules\Shipping\Presentation\Http\Controllers;

use App\Modules\Cart\Application\Actions\ShoppingCart;
use App\Modules\Cart\Application\Services\CartPricer;
use App\Modules\Cart\Presentation\Http\Support\CartCookie;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Shipping\Application\Contracts\ShippingRates;
use App\Modules\Shipping\Domain\ParcelWeight;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class StoreShippingController
{
    /**
     * Delivery methods for a district
     *
     * The active methods of the active zone covering `district_id` (`[]` when none):
     * `{id, name, description, fee, free_over, cod_allowed, cod_fee, eta_min_days, eta_max_days,
     * base_fee, area_adjustment, weight_fee}`. BD2a: priced like the checkout preview's
     * `shipping_methods` — for `area_id` (optional, a delivery area of the district; any other
     * is ignored) and the weight of the shopper's cart (its available lines); `fee` is before
     * `free_over`.
     */
    public function __invoke(Request $request, ShippingRates $rates, ShoppingCart $carts, CartPricer $pricer, ProductDirectory $products, TenantContext $tenant): JsonResponse
    {
        $data = $request->validate([
            'district_id' => ['required', 'integer', 'min:1', 'max:65535'],
            'area_id' => ['sometimes', 'nullable', 'uuid'],
        ]);
        $cart = $carts->find(CartCookie::owner($request));
        $lines = $cart === null ? [] : $pricer->quote($cart)['lines'];
        $weight = $lines === [] ? 0 : ParcelWeight::grams($lines, $products->variants($tenant->requireOrganization(), array_values(array_unique(array_column($lines, 'variant_id')))));

        return ApiResponse::success($rates->methodsForDistrict((int) $data['district_id'], isset($data['area_id']) ? strtolower($data['area_id']) : null, $weight));
    }
}
