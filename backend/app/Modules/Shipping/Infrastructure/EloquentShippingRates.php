<?php

namespace App\Modules\Shipping\Infrastructure;

use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Domain\Translations;
use App\Modules\Shipping\Application\Contracts\ShippingRates;
use App\Modules\Shipping\Domain\DeliveryOverview;
use App\Modules\Shipping\Infrastructure\Models\ShippingMethod;
use App\Modules\Shipping\Infrastructure\Models\ShippingZone;
use App\Modules\Shipping\Infrastructure\Models\ShippingZoneDistrict;
use Illuminate\Database\Query\Builder;

class EloquentShippingRates implements ShippingRates
{
    /** E12b: names and descriptions in the request's language (orders snapshot the base name). */
    public function __construct(private readonly LocaleContext $locale) {}

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
            ->map(fn (ShippingMethod $m) => self::option($m, $this->locale->current()))
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
