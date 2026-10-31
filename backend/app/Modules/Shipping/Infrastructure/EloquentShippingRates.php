<?php

namespace App\Modules\Shipping\Infrastructure;

use App\Modules\Shipping\Application\Contracts\ShippingRates;
use App\Modules\Shipping\Infrastructure\Models\ShippingMethod;
use App\Modules\Shipping\Infrastructure\Models\ShippingZoneDistrict;
use App\Modules\Shipping\Infrastructure\Models\ShippingZone;

class EloquentShippingRates implements ShippingRates
{
    public function methodsForDistrict(int $districtId): array
    {
        $zoneId = ShippingZoneDistrict::query()->where('district_id', $districtId)->value('zone_id');
        if ($zoneId === null || ! ShippingZone::query()->whereKey($zoneId)->where('is_active', true)->exists()) {
            return [];
        }

        return ShippingMethod::query()
            ->where('zone_id', $zoneId)
            ->where('is_active', true)
            ->orderBy('sort_order')->orderBy('name')
            ->get()
            ->map(fn (ShippingMethod $m) => self::option($m))
            ->values()
            ->all();
    }

    public function methodForDistrict(string $methodId, int $districtId): ?array
    {
        foreach ($this->methodsForDistrict($districtId) as $method) {
            if ($method['id'] === $methodId) {
                return $method;
            }
        }

        return null;
    }

    /**
     * @return array{id: string, name: string, description: ?string, fee: string, free_over: ?string, cod_allowed: bool, cod_fee: string, eta_min_days: int, eta_max_days: int}
     */
    public static function option(ShippingMethod $m): array
    {
        return [
            'id' => $m->id,
            'name' => $m->name,
            'description' => $m->description,
            'fee' => (string) $m->fee,
            'free_over' => $m->free_over === null ? null : (string) $m->free_over,
            'cod_allowed' => $m->cod_allowed,
            'cod_fee' => (string) $m->cod_fee,
            'eta_min_days' => $m->eta_min_days,
            'eta_max_days' => $m->eta_max_days,
        ];
    }
}
