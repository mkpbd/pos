<?php

namespace App\Modules\Shipping\Presentation\Http\Controllers;

use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Shipping\Application\Actions\ManageShippingMethods;
use App\Modules\Shipping\Application\Actions\ManageShippingZones;
use App\Modules\Shipping\Infrastructure\Models\ShippingMethod;
use App\Modules\Shipping\Infrastructure\Models\ShippingZone;
use App\Modules\Shipping\Presentation\Http\Support\ShippingPresenter;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Delivery zones (sets of districts) and their delivery methods. Reading needs
 * `shipping.manage` or `web_orders.view`; changes need `shipping.manage`.
 */
class ShippingZoneController
{
    public function __construct(private readonly ShippingPresenter $presenter) {}

    /**
     * Delivery zones
     *
     * Every zone with its districts (`[{id, name}]` by name) and methods, in display order.
     */
    public function index(Request $request): JsonResponse
    {
        if (! $request->user()->canAny(['shipping.manage', 'web_orders.view'])) {
            throw new AuthorizationException;
        }

        return ApiResponse::success($this->presenter->zones(ShippingZone::query()->orderBy('sort_order')->orderBy('name')->get()));
    }

    /**
     * Create a delivery zone
     *
     * A district may be in one zone only (`DISTRICT_IN_OTHER_ZONE`, details.districts names them).
     */
    public function store(Request $request, ManageShippingZones $zones): JsonResponse
    {
        return ApiResponse::created($this->presenter->zone($zones->create($this->zoneData($request, true))));
    }

    /**
     * Change a delivery zone
     *
     * Any subset of the fields; `district_ids` replaces the zone's districts.
     */
    public function update(Request $request, ShippingZone $zone, ManageShippingZones $zones): JsonResponse
    {
        return ApiResponse::success($this->presenter->zone($zones->update($zone, $this->zoneData($request, false))));
    }

    /**
     * Delete a delivery zone
     *
     * Its methods go with it; orders keep their copy of the method name.
     */
    public function destroy(ShippingZone $zone, ManageShippingZones $zones): JsonResponse
    {
        $zones->delete($zone);

        return ApiResponse::noContent();
    }

    /**
     * Add a delivery method
     *
     * Free delivery from `free_over` (goods total after tax); `cod_fee` is charged when the
     * shopper pays cash on delivery; ETA in days (0–30, min ≤ max).
     */
    public function storeMethod(Request $request, ShippingZone $zone, ManageShippingMethods $methods): JsonResponse
    {
        return ApiResponse::created(ShippingPresenter::method($methods->create($zone, $this->methodData($request, true))));
    }

    /**
     * Change a delivery method
     */
    public function updateMethod(Request $request, ShippingMethod $method, ManageShippingMethods $methods): JsonResponse
    {
        return ApiResponse::success(ShippingPresenter::method($methods->update($method, $this->methodData($request, false))));
    }

    /**
     * Delete a delivery method
     */
    public function destroyMethod(ShippingMethod $method, ManageShippingMethods $methods): JsonResponse
    {
        $methods->delete($method);

        return ApiResponse::noContent();
    }

    /**
     * @return array<string, mixed>
     */
    private function zoneData(Request $request, bool $creating): array
    {
        $required = $creating ? 'required' : 'sometimes';
        $data = $request->validate([
            'name' => [$required, 'string', 'max:60'],
            'is_active' => ['sometimes', 'boolean'],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:9999'],
            'district_ids' => ['sometimes', 'array', 'max:64'],
            'district_ids.*' => ['integer', 'distinct', 'exists:geo_districts,id'],
        ]);
        if (isset($data['name'])) {
            $data['name'] = trim($data['name']);
        }
        if (array_key_exists('is_active', $data)) {
            $data['is_active'] = $request->boolean('is_active');
        }
        if (array_key_exists('district_ids', $data)) {
            $data['district_ids'] = array_map('intval', $data['district_ids']);
        }

        return $data;
    }

    /**
     * @return array<string, mixed>
     */
    private function methodData(Request $request, bool $creating): array
    {
        $required = $creating ? 'required' : 'sometimes';
        $money = ['numeric', 'min:0', 'max:99999999', 'decimal:0,2'];
        $data = $request->validate([
            'name' => [$required, 'string', 'max:60'],
            'description' => ['sometimes', 'nullable', 'string', 'max:160'],
            'fee' => [$required, ...$money],
            'free_over' => ['sometimes', 'nullable', ...$money],
            'cod_allowed' => ['sometimes', 'boolean'],
            'cod_fee' => ['sometimes', 'nullable', ...$money],
            'eta_min_days' => [$required, 'integer', 'min:0', 'max:30'],
            'eta_max_days' => [$required, 'integer', 'min:0', 'max:30'],
            'is_active' => ['sometimes', 'boolean'],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:9999'],
            // E12b: {bn: {name, description}} (partial; blank removes).
            ...TranslationInput::rules(ManageShippingMethods::TRANSLATABLE),
        ]);
        foreach (['cod_allowed', 'is_active'] as $flag) {
            if (array_key_exists($flag, $data)) {
                $data[$flag] = $request->boolean($flag);
            }
        }
        if (isset($data['name'])) {
            $data['name'] = trim($data['name']);
        }

        return $data;
    }
}
