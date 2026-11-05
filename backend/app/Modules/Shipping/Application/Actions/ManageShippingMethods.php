<?php

namespace App\Modules\Shipping\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shipping\Infrastructure\Models\ShippingMethod;
use App\Modules\Shipping\Infrastructure\Models\ShippingZone;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Delivery methods of a zone. Amounts are stored at 2 decimals; the delivery time needs
 * eta_min_days ≤ eta_max_days (0–30).
 */
class ManageShippingMethods
{
    private const FIELDS = ['name', 'description', 'fee', 'free_over', 'cod_allowed', 'cod_fee', 'eta_min_days', 'eta_max_days', 'is_active', 'sort_order'];

    /** E12b: translatable texts with the limits of their base fields. */
    public const TRANSLATABLE = ['name' => ['max:60'], 'description' => ['max:160']];

    public function __construct(private readonly AuditTrail $audit) {}

    /**
     * @param  array<string, mixed>  $data
     */
    public function create(ShippingZone $zone, array $data): ShippingMethod
    {
        $this->assertEta((int) $data['eta_min_days'], (int) $data['eta_max_days']);

        return DB::transaction(function () use ($zone, $data) {
            $method = ShippingMethod::query()->create(['zone_id' => $zone->id] + $this->attributes($data) + $this->translations(null, $data));
            $this->audit->record('shipping.method_created', $method, new: $this->attributes($data));

            return $method;
        });
    }

    /**
     * @param  array<string, mixed>  $data
     */
    public function update(ShippingMethod $method, array $data): ShippingMethod
    {
        $this->assertEta((int) ($data['eta_min_days'] ?? $method->eta_min_days), (int) ($data['eta_max_days'] ?? $method->eta_max_days));

        return DB::transaction(function () use ($method, $data) {
            $method->fill($this->attributes($data) + $this->translations($method, $data))->save();
            $this->audit->record('shipping.method_updated', $method, new: $this->attributes($data));

            return $method;
        });
    }

    public function delete(ShippingMethod $method): void
    {
        DB::transaction(function () use ($method) {
            $method->delete();
            $this->audit->record('shipping.method_deleted', $method, old: $method->only(['name', 'zone_id']));
        });
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function attributes(array $data): array
    {
        $attributes = array_intersect_key($data, array_flip(self::FIELDS));
        foreach (['fee', 'cod_fee', 'free_over'] as $money) {
            if (array_key_exists($money, $attributes) && $attributes[$money] !== null) {
                $attributes[$money] = Decimal::round((string) $attributes[$money], 2);
            }
        }
        if (array_key_exists('cod_fee', $attributes) && $attributes['cod_fee'] === null) {
            $attributes['cod_fee'] = '0.00';
        }
        if (array_key_exists('description', $attributes) && is_string($attributes['description'])) {
            $attributes['description'] = trim($attributes['description']) === '' ? null : trim($attributes['description']);
        }

        return $attributes;
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{translations?: ?array<string, array<string, string>>}
     */
    private function translations(?ShippingMethod $method, array $data): array
    {
        return array_key_exists('translations', $data)
            ? ['translations' => TranslationInput::apply($method?->translations, $data['translations'], array_keys(self::TRANSLATABLE))]
            : [];
    }

    private function assertEta(int $min, int $max): void
    {
        if ($min > $max) {
            throw ValidationException::withMessages(['eta_max_days' => ['The latest delivery day must not be before the earliest.']]);
        }
    }
}
