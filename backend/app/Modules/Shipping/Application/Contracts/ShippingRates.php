<?php

namespace App\Modules\Shipping\Application\Contracts;

/**
 * What checkout may ask the Shipping module (organization from the tenant context):
 * the active delivery methods of the active zone that covers a district.
 *
 * @phpstan-type ShippingOption array{
 *   id: string, name: string, description: ?string, fee: string, free_over: ?string,
 *   cod_allowed: bool, cod_fee: string, eta_min_days: int, eta_max_days: int
 * }
 */
interface ShippingRates
{
    /**
     * @return list<ShippingOption> in display order; [] when no active zone/method covers it
     */
    public function methodsForDistrict(int $districtId): array;

    /**
     * The method when it is offered for the district, else null.
     *
     * @return ShippingOption|null
     */
    public function methodForDistrict(string $methodId, int $districtId): ?array;
}
