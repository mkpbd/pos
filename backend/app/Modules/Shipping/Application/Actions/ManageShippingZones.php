<?php

namespace App\Modules\Shipping\Application\Actions;

use App\Modules\Geography\Application\Contracts\GeoDirectory;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shipping\Infrastructure\Models\ShippingZone;
use App\Modules\Shipping\Infrastructure\Models\ShippingZoneDistrict;
use Illuminate\Support\Facades\DB;

/**
 * Delivery zones. A district can be in one zone only (per organization): saving a zone with
 * a district that another zone already covers fails with DISTRICT_IN_OTHER_ZONE, naming the
 * districts and their zones. The unique index backs the rule up against concurrent saves.
 * Deleting a zone deletes its methods; orders keep their snapshot of the method.
 */
class ManageShippingZones
{
    public function __construct(
        private readonly GeoDirectory $geo,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{name: string, is_active?: bool, sort_order?: int, district_ids?: list<int>}  $data
     */
    public function create(array $data): ShippingZone
    {
        return DB::transaction(function () use ($data) {
            $zone = ShippingZone::query()->create(array_intersect_key($data, array_flip(['name', 'is_active', 'sort_order'])));
            $this->replaceDistricts($zone, $data['district_ids'] ?? []);
            $this->audit->record('shipping.zone_created', $zone, new: $zone->only(['name', 'is_active']) + ['district_ids' => $data['district_ids'] ?? []]);

            return $zone;
        });
    }

    /**
     * @param  array{name?: string, is_active?: bool, sort_order?: int, district_ids?: list<int>}  $data
     */
    public function update(ShippingZone $zone, array $data): ShippingZone
    {
        return DB::transaction(function () use ($zone, $data) {
            $zone->fill(array_intersect_key($data, array_flip(['name', 'is_active', 'sort_order'])))->save();
            if (array_key_exists('district_ids', $data)) {
                $this->replaceDistricts($zone, $data['district_ids']);
            }
            $this->audit->record('shipping.zone_updated', $zone, new: $data);

            return $zone;
        });
    }

    public function delete(ShippingZone $zone): void
    {
        DB::transaction(function () use ($zone) {
            $zone->delete();
            $this->audit->record('shipping.zone_deleted', $zone, old: $zone->only(['name']));
        });
    }

    /**
     * @param  list<int>  $districtIds
     */
    private function replaceDistricts(ShippingZone $zone, array $districtIds): void
    {
        $districtIds = array_values(array_unique(array_map('intval', $districtIds)));
        $taken = ShippingZoneDistrict::query()
            ->whereIn('district_id', $districtIds)
            ->where('zone_id', '!=', $zone->id)
            ->lockForUpdate()
            ->get(['zone_id', 'district_id']);

        if ($taken->isNotEmpty()) {
            $names = $this->geo->names([], $taken->pluck('district_id')->all())['districts'];
            $zones = ShippingZone::query()->whereKey($taken->pluck('zone_id')->unique()->all())->pluck('name', 'id');
            $conflicts = $taken->map(fn (ShippingZoneDistrict $d) => [
                'id' => $d->district_id,
                'name' => $names[$d->district_id] ?? '',
                'zone_id' => $d->zone_id,
                'zone_name' => $zones[$d->zone_id] ?? '',
            ])->sortBy('name')->values()->all();

            throw new BusinessRuleViolation(
                'DISTRICT_IN_OTHER_ZONE',
                'A district can be in one delivery zone only: '.implode(', ', array_map(fn (array $c) => "{$c['name']} ({$c['zone_name']})", $conflicts)).'.',
                ['district_ids' => array_column($conflicts, 'id'), 'districts' => $conflicts],
            );
        }

        ShippingZoneDistrict::query()->where('zone_id', $zone->id)->whereNotIn('district_id', $districtIds)->delete();
        $existing = ShippingZoneDistrict::query()->where('zone_id', $zone->id)->pluck('district_id')->all();
        foreach (array_diff($districtIds, $existing) as $districtId) {
            ShippingZoneDistrict::query()->create(['zone_id' => $zone->id, 'district_id' => $districtId]);
        }
    }
}
