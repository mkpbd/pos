<?php

namespace App\Modules\Catalog\Application\Actions;

use App\Modules\Catalog\Infrastructure\Models\Unit;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * Units are either base units (pcs, kg) or derived from a base unit with a
 * conversion factor (box = 12 pcs). Derivations are one level deep, so a
 * conversion never needs to be chained.
 */
class SaveUnit
{
    public function __construct(private readonly SaveCatalogRecord $save) {}

    /**
     * @param  array<string, mixed>  $attributes
     */
    public function __invoke(?Unit $unit, array $attributes): Unit
    {
        return ($this->save)($unit ?? new Unit, $attributes, 'unit', function (Unit $unit) {
            if ($unit->base_unit_id === null) {
                $unit->conversion_factor = null;

                return;
            }

            if ($unit->exists && $unit->base_unit_id === $unit->id) {
                throw new BusinessRuleViolation('INVALID_BASE_UNIT', 'A unit cannot be its own base unit.');
            }

            $base = Unit::query()->find($unit->base_unit_id);
            if ($base === null || $base->base_unit_id !== null) {
                throw new BusinessRuleViolation('INVALID_BASE_UNIT', 'The base unit must be a unit without a base unit of its own.');
            }

            if ($unit->exists && Unit::query()->where('base_unit_id', $unit->id)->exists()) {
                throw new BusinessRuleViolation('INVALID_BASE_UNIT', 'Other units are derived from this unit, so it must stay a base unit.');
            }

            if ($unit->conversion_factor === null || bccomp((string) $unit->conversion_factor, '0', 6) <= 0) {
                throw new BusinessRuleViolation('INVALID_CONVERSION_FACTOR', 'A derived unit needs a conversion factor greater than zero.');
            }
        });
    }
}
