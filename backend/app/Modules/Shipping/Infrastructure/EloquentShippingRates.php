<?php

namespace App\Modules\Shipping\Infrastructure;

use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Domain\Translations;
use App\Modules\Shipping\Application\Contracts\ShippingRates;
use App\Modules\Shipping\Domain\DeliveryOverview;
use App\Modules\Shipping\Domain\ShippingFee;
use App\Modules\Shipping\Infrastructure\Models\ShippingArea;
use App\Modules\Shipping\Infrastructure\Models\ShippingMethod;
use App\Modules\Shipping\Infrastructure\Models\ShippingZone;
use App\Modules\Shipping\Infrastructure\Models\ShippingZoneDistrict;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Str;

class EloquentShippingRates implements ShippingRates
{
    /** E12b: names and descriptions in the request's language (orders snapshot the base name). */
    public function __construct(private readonly LocaleContext $locale) {}

    public function methodsForDistrict(int $districtId, ?string $areaId = null, int $weightGrams = 0): array
    {
        $zoneId = ShippingZoneDistrict::query()->where('district_id', $districtId)->value('zone_id');
        if ($zoneId === null || ! ShippingZone::query()->whereKey($zoneId)->where('is_active', true)->exists()) {
            return [];
        }
        // BD2a: an unknown area, or one of another district, adds nothing (callers validate it).
        $adjustment = $areaId === null || ! Str::isUuid($areaId) ? null : ShippingArea::query()
            ->whereKey($areaId)->where('district_id', $districtId)->where('is_active', true)->value('fee_adjustment');
        $adjustment = $adjustment === null ? '0.00' : (string) $adjustment;

        return ShippingMethod::query()
            ->where('zone_id', $zoneId)
            ->where('is_active', true)
            ->orderBy('sort_order')->orderBy('name')
            ->get()
            ->map(fn (ShippingMethod $m) => array_merge(self::option($m, $this->locale->current()), ShippingFee::forDelivery(
                (string) $m->fee, $adjustment, $m->weight_included_kg === null ? null : (string) $m->weight_included_kg, (string) $m->fee_per_extra_kg, max(0, $weightGrams),
            )))
            ->values()
            ->all();
    }

    public function methodForDistrict(string $methodId, int $districtId, ?string $areaId = null, int $weightGrams = 0): ?array
    {
        foreach ($this->methodsForDistrict($districtId, $areaId, $weightGrams) as $method) {
            if ($method['id'] === $methodId) {
                return $method;
            }
        }

        return null;
    }

    public function areas(int $districtId): array
    {
        return ShippingArea::query()
            ->where('district_id', $districtId)
            ->where('is_active', true)
            ->orderBy('sort_order')->orderBy('name')
            ->get(['id', 'name', 'fee_adjustment'])
            ->map(fn (ShippingArea $a) => ['id' => $a->id, 'name' => $a->name, 'fee_adjustment' => (string) $a->fee_adjustment])
            ->values()
            ->all();
    }

    public function districtMethods(): array
    {
        $locale = $this->locale->current();
        $zones = ShippingZone::query()
            ->where('is_active', true)
            ->with(['methods' => fn ($q) => $q->where('is_active', true)->orderBy('sort_order')->orderBy('name')])
            ->orderBy('sort_order')->orderBy('name')->orderBy('id')
            ->get();
        $methods = [];
        $byZone = [];
        foreach ($zones as $zone) {
            foreach ($zone->methods as $method) {
                $methods[] = self::option($method, $locale);
                $byZone[$zone->id][] = $method->id;
            }
        }
        $districts = [];
        if ($byZone !== []) {
            foreach (ShippingZoneDistrict::query()->whereIn('zone_id', array_keys($byZone))->orderBy('district_id')->get(['zone_id', 'district_id']) as $row) {
                $districts[(string) $row->district_id] = $byZone[$row->zone_id];
            }
        }

        return ['methods' => $methods, 'districts' => $districts];
    }

    public function zoneOverview(): array
    {
        $locale = $this->locale->current();
        $zones = ShippingZone::query()
            ->where('is_active', true)
            ->whereExists(fn (Builder $q) => $q->from('shipping_zone_districts as d')->whereColumn('d.zone_id', 'shipping_zones.id'))
            ->with(['methods' => fn ($q) => $q->where('is_active', true)])
            ->orderBy('sort_order')->orderBy('name')->orderBy('id')
            ->get();

        $result = [];
        foreach ($zones as $zone) {
            $methods = $zone->methods->map(fn (ShippingMethod $m) => self::option($m, $locale))->values()->all();
            if ($methods !== []) {
                $result[] = DeliveryOverview::zone($zone->name, array_map(fn (array $m) => [
                    'name' => (string) $m['name'],
                    'fee' => $m['fee'],
                    'free_over' => $m['free_over'],
                    'cod_allowed' => $m['cod_allowed'],
                    'eta_min_days' => $m['eta_min_days'],
                    'eta_max_days' => $m['eta_max_days'],
                ], $methods));
            }
        }

        return $result;
    }

    public function activeZones(): array
    {
        $locale = $this->locale->current();

        return ShippingZone::query()
            ->where('is_active', true)
            ->withExists('districts')
            ->with(['methods' => fn ($q) => $q->where('is_active', true)])
            ->orderBy('sort_order')->orderBy('name')->orderBy('id')
            ->get()
            ->map(fn (ShippingZone $zone) => [
                'id' => $zone->id,
                'name' => $zone->name,
                'covers_districts' => (bool) $zone->districts_exists,
                'methods' => $zone->methods->map(fn (ShippingMethod $m) => self::option($m, $locale))->values()->all(),
            ])
            ->values()
            ->all();
    }

    /**
     * @return array{id: string, name: string, description: ?string, fee: string, free_over: ?string, cod_allowed: bool, cod_fee: string, eta_min_days: int, eta_max_days: int}
     */
    public static function option(ShippingMethod $m, string $locale = LocaleContext::BASE): array
    {
        return [
            'id' => $m->id,
            'name' => Translations::pick($m, 'name', $locale),
            'description' => Translations::pick($m, 'description', $locale),
            'fee' => (string) $m->fee,
            'free_over' => $m->free_over === null ? null : (string) $m->free_over,
            'cod_allowed' => $m->cod_allowed,
            'cod_fee' => (string) $m->cod_fee,
            'eta_min_days' => $m->eta_min_days,
            'eta_max_days' => $m->eta_max_days,
        ];
    }
}
