<?php

namespace App\Modules\Shipping\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shipping\Infrastructure\Models\ShippingArea;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * BD2a: delivery areas inside a district (thana / upazila), each with a fee adjustment
 * (may be negative) added to the district's delivery methods. Names are unique per district,
 * ignoring case (the unique index backs the check up against concurrent saves). Orders keep
 * their copy of the area name, so deleting an area changes no order.
 */
class ManageShippingAreas
{
    private const FIELDS = ['district_id', 'name', 'fee_adjustment', 'is_active', 'sort_order'];

    public function __construct(private readonly AuditTrail $audit) {}

    /**
     * @param  array{district_id: int, name: string, fee_adjustment?: string|int|float|null, is_active?: bool, sort_order?: int}  $data
     */
    public function create(array $data): ShippingArea
    {
        return DB::transaction(function () use ($data) {
            $attributes = $this->attributes($data);
            $this->assertUniqueName((int) $attributes['district_id'], $attributes['name'], null);
            $area = ShippingArea::query()->create($attributes);
            $this->audit->record('shipping.area_created', $area, new: $attributes);

            return $area;
        });
    }

    /**
     * @param  array{district_id?: int, name?: string, fee_adjustment?: string|int|float|null, is_active?: bool, sort_order?: int}  $data
     */
    public function update(ShippingArea $area, array $data): ShippingArea
    {
        return DB::transaction(function () use ($area, $data) {
            $attributes = $this->attributes($data);
            $old = $area->only(array_keys($attributes));
            $area->fill($attributes);
            $this->assertUniqueName($area->district_id, $area->name, $area->id);
            $area->save();
            $this->audit->record('shipping.area_updated', $area, old: $old, new: $attributes);

            return $area;
        });
    }

    public function delete(ShippingArea $area): void
    {
        DB::transaction(function () use ($area) {
            $area->delete();
            $this->audit->record('shipping.area_deleted', $area, old: $area->only(['district_id', 'name', 'fee_adjustment']));
        });
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function attributes(array $data): array
    {
        $attributes = array_intersect_key($data, array_flip(self::FIELDS));
        if (array_key_exists('fee_adjustment', $attributes)) {
            $attributes['fee_adjustment'] = Decimal::round((string) ($attributes['fee_adjustment'] ?? '0'), 2);
        }
        if (isset($attributes['name'])) {
            $attributes['name'] = trim((string) $attributes['name']);
        }

        return $attributes;
    }

    private function assertUniqueName(int $districtId, string $name, ?string $exceptId): void
    {
        $taken = ShippingArea::query()
            ->where('district_id', $districtId)
            ->whereRaw('lower(name) = lower(?)', [$name])
            ->when($exceptId !== null, fn ($q) => $q->whereKeyNot($exceptId))
            ->exists();
        if ($taken) {
            throw ValidationException::withMessages(['name' => ['The district already has an area with this name.']]);
        }
    }
}
