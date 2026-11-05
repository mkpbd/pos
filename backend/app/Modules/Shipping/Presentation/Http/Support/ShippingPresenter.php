<?php

namespace App\Modules\Shipping\Presentation\Http\Support;

use App\Modules\Geography\Application\Contracts\GeoDirectory;
use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Shipping\Infrastructure\EloquentShippingRates;
use App\Modules\Shipping\Infrastructure\Models\ShippingMethod;
use App\Modules\Shipping\Infrastructure\Models\ShippingZone;
use Illuminate\Database\Eloquent\Collection;

class ShippingPresenter
{
    public function __construct(private readonly GeoDirectory $geo) {}

    /**
     * @param  Collection<int, ShippingZone>  $zones
     * @return list<array<string, mixed>>
     */
    public function zones(Collection $zones): array
    {
        $zones->load(['districts', 'methods']);
        $names = $this->geo->names([], $zones->flatMap(fn (ShippingZone $z) => $z->districts->pluck('district_id'))->all())['districts'];

        return $zones->map(fn (ShippingZone $z) => [
            'id' => $z->id,
            'name' => $z->name,
            'is_active' => $z->is_active,
            'sort_order' => $z->sort_order,
            'districts' => $z->districts
                ->map(fn ($d) => ['id' => $d->district_id, 'name' => $names[$d->district_id] ?? ''])
                ->sortBy('name')->values()->all(),
            'methods' => $z->methods->map(fn (ShippingMethod $m) => self::method($m))->values()->all(),
        ])->values()->all();
    }

    /**
     * @return array<string, mixed>
     */
    public function zone(ShippingZone $zone): array
    {
        return $this->zones(new Collection([$zone->fresh()]))[0];
    }

    /**
     * @return array<string, mixed>
     */
    public static function method(ShippingMethod $m): array
    {
        return ['id' => $m->id, 'zone_id' => $m->zone_id] + EloquentShippingRates::option($m) + [
            'is_active' => $m->is_active,
            'sort_order' => $m->sort_order,
            // E12b: {bn: {name, description}}.
            'translations' => TranslationInput::present($m->translations),
        ];
    }
}
