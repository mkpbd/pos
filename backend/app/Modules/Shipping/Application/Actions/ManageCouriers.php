<?php

namespace App\Modules\Shipping\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Infrastructure\Persistence\ReferentialIntegrity;
use App\Modules\Shipping\Infrastructure\Models\Courier;
use Illuminate\Support\Facades\DB;

/**
 * Couriers (E10a). A courier that carried a shipment or sent a COD remittance cannot be
 * deleted (`IN_USE`, from the restricting foreign keys) — deactivate it instead; inactive
 * couriers cannot take new shipments.
 */
class ManageCouriers
{
    private const FIELDS = ['name', 'phone', 'tracking_url_template', 'is_active', 'sort_order'];

    public function __construct(private readonly AuditTrail $audit) {}

    /**
     * @param  array{name: string, phone?: ?string, tracking_url_template?: ?string, is_active?: bool, sort_order?: int}  $data
     */
    public function create(array $data): Courier
    {
        return DB::transaction(function () use ($data) {
            $courier = Courier::query()->create($this->attributes($data));
            $this->audit->record('courier.created', $courier, new: $courier->only(self::FIELDS));

            return $courier;
        });
    }

    /**
     * @param  array<string, mixed>  $data
     */
    public function update(Courier $courier, array $data): Courier
    {
        return DB::transaction(function () use ($courier, $data) {
            $before = $courier->only(self::FIELDS);
            $courier->fill($this->attributes($data))->save();
            [$old, $new] = Changes::between($before, $courier->only(self::FIELDS));
            if ($new !== []) {
                $this->audit->record('courier.updated', $courier, $old, $new);
            }

            return $courier;
        });
    }

    public function delete(Courier $courier): void
    {
        DB::transaction(function () use ($courier) {
            ReferentialIntegrity::deleteOrFail($courier, 'courier');
            $this->audit->record('courier.deleted', $courier, old: $courier->only(['name']));
        });
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function attributes(array $data): array
    {
        $attributes = array_intersect_key($data, array_flip(self::FIELDS));
        foreach (['name', 'phone', 'tracking_url_template'] as $text) {
            if (array_key_exists($text, $attributes) && is_string($attributes[$text])) {
                $attributes[$text] = trim($attributes[$text]);
                if ($text !== 'name' && $attributes[$text] === '') {
                    $attributes[$text] = null;
                }
            }
        }

        return $attributes;
    }
}
